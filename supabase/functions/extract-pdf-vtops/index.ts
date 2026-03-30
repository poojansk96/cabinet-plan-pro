import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type VtopRow = {
  length: number;
  depth: number;
  bowlPosition: "offset-left" | "offset-right" | "center";
  bowlOffset: number | null;
  leftWall: boolean;
  rightWall: boolean;
};

type ParsedExtraction = {
  unitTypeName: string;
  vtops: VtopRow[];
};

type ModelAttempt = {
  name: string;
  retries: number;
};

const PRIMARY_MODELS: ModelAttempt[] = [
  { name: "gemini-3-flash-preview", retries: 3 },
  { name: "gemini-2.5-pro", retries: 2 },
];

const STRIP_MODELS: ModelAttempt[] = [
  { name: "gemini-3-flash-preview", retries: 2 },
  { name: "gemini-2.5-pro", retries: 1 },
];

function normalizeVtop(vt: any): VtopRow {
  const length = Math.round((Number(vt?.length) || 31) * 4) / 4;
  const depth = Math.round((Number(vt?.depth) || 22) * 4) / 4;
  const bowlPosition = ["offset-left", "offset-right", "center"].includes(vt?.bowlPosition)
    ? vt.bowlPosition
    : "center";
  const bowlOffset = bowlPosition !== "center"
    ? Math.round((Number(vt?.bowlOffset) || 0) * 4) / 4
    : null;
  return {
    length,
    depth,
    bowlPosition,
    bowlOffset,
    leftWall: Boolean(vt?.leftWall),
    rightWall: Boolean(vt?.rightWall),
  };
}

function parseExtractionText(content: string): ParsedExtraction {
  let parsed: { unitTypeName?: string; vtops?: any[] } = {};
  try {
    let cleaned = content
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();

    const starts = [cleaned.indexOf('{"unitTypeName"'), cleaned.indexOf('{"vtops"')].filter(i => i >= 0);
    const start = starts.length > 0 ? Math.min(...starts) : cleaned.indexOf("{");
    if (start >= 0) cleaned = cleaned.slice(start);

    const end = cleaned.lastIndexOf("}");
    if (end >= 0) cleaned = cleaned.slice(0, end + 1);

    parsed = JSON.parse(cleaned);
  } catch {
    console.error("JSON parse failed, raw:", content.slice(0, 500));
  }

  return {
    unitTypeName: String(parsed.unitTypeName || "").trim(),
    vtops: Array.isArray(parsed.vtops) ? parsed.vtops.map(normalizeVtop) : [],
  };
}

function vtopMatchScore(a: VtopRow, b: VtopRow): number {
  const lengthDiff = Math.abs(a.length - b.length);
  const depthDiff = Math.abs(a.depth - b.depth);
  if (lengthDiff > 3 || depthDiff > 2) return Number.POSITIVE_INFINITY;

  if (a.bowlPosition !== b.bowlPosition) return Number.POSITIVE_INFINITY;
  if (a.bowlPosition !== "center") {
    const offA = a.bowlOffset ?? 0;
    const offB = b.bowlOffset ?? 0;
    if (Math.abs(offA - offB) > 4) return Number.POSITIVE_INFINITY;
  }

  return lengthDiff + depthDiff;
}

function mergeWallEvidence(primary: VtopRow[], stripSets: VtopRow[][]): VtopRow[] {
  if (!primary.length || !stripSets.length) return primary;

  const merged = primary.map((row) => ({
    ...row,
    leftWallVotes: 0,
    rightWallVotes: 0,
  }));

  const stripOnly = new Map<string, { row: VtopRow; support: number }>();
  const stripKey = (row: VtopRow) => `${row.length}|${row.depth}|${row.bowlPosition}|${row.bowlOffset ?? ""}`;

  for (const stripRows of stripSets) {
    const matchedIndices = new Set<number>();
    for (const stripRow of stripRows) {
      let bestIdx = -1;
      let bestScore = Number.POSITIVE_INFINITY;

      for (let i = 0; i < merged.length; i++) {
        if (matchedIndices.has(i)) continue;
        const score = vtopMatchScore(merged[i], stripRow);
        if (score < bestScore) {
          bestScore = score;
          bestIdx = i;
        }
      }

      if (bestIdx >= 0 && Number.isFinite(bestScore)) {
        if (stripRow.leftWall) merged[bestIdx].leftWallVotes += 1;
        if (stripRow.rightWall) merged[bestIdx].rightWallVotes += 1;
        matchedIndices.add(bestIdx);
      } else {
        const key = stripKey(stripRow);
        const existing = stripOnly.get(key);
        if (existing) {
          existing.support += 1;
          existing.row.leftWall = existing.row.leftWall || stripRow.leftWall;
          existing.row.rightWall = existing.row.rightWall || stripRow.rightWall;
        } else {
          stripOnly.set(key, { row: { ...stripRow }, support: 1 });
        }
      }
    }
  }

  const finalized = merged.map((row) => ({
    length: row.length,
    depth: row.depth,
    bowlPosition: row.bowlPosition,
    bowlOffset: row.bowlOffset,
    leftWall: row.leftWall || row.leftWallVotes > 0,
    rightWall: row.rightWall || row.rightWallVotes > 0,
  }));

  for (const candidate of stripOnly.values()) {
    if (candidate.support >= 2) {
      finalized.push(candidate.row);
    }
  }

  return finalized;
}

async function requestGemini(
  apiKey: string,
  pageImage: string,
  prompt: string,
  models: ModelAttempt[],
  generationConfig: { temperature: number; maxOutputTokens: number },
): Promise<string> {
  let response: Response | null = null;

  for (const { name: model, retries } of models) {
    console.log(`Trying model: ${model} (${retries} attempts)`);
    let succeeded = false;

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{
                role: "user",
                parts: [
                  { inlineData: { mimeType: "image/jpeg", data: pageImage } },
                  { text: prompt },
                ],
              }],
              generationConfig,
            }),
          },
        );
      } catch (fetchErr) {
        console.error(`AI fetch error (${model}, attempt ${attempt + 1}):`, fetchErr);
        if (attempt < retries - 1) {
          await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
          continue;
        }
        response = null;
        break;
      }

      if (response.status === 429) throw new Error("rate_limit");
      if (response.status === 402) throw new Error("credits");

      if (response.status === 503 || response.status === 500) {
        console.warn(`AI unavailable (${response.status}) for ${model}, attempt ${attempt + 1}/${retries}`);
        response = null;
        if (attempt < retries - 1) {
          await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
          continue;
        }
        break;
      }

      if (!response.ok) {
        const errText = await response.text();
        console.error("AI error:", response.status, errText);
        throw new Error(`AI error: ${response.status}`);
      }

      succeeded = true;
      break;
    }

    if (succeeded && response) {
      const aiData = await response.json();
      return aiData.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    }

    console.warn(`Model ${model} failed, trying next fallback...`);
  }

  throw new Error("ai_unavailable");
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not configured");

    const { pageImage, stripImages } = await req.json();

    if (!pageImage || typeof pageImage !== "string") {
      return new Response(JSON.stringify({ error: "pageImage (base64 string) required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const safeStripImages: string[] = Array.isArray(stripImages)
      ? stripImages.filter((img: unknown) => typeof img === "string" && img.length > 1000).slice(0, 3)
      : [];

    const fullPrompt = `You are an expert millwork estimator analyzing a 2020 countertop shop drawing page.

TASK:
1. Find the UNIT TYPE NAME from the drawing's title block (usually bottom-right or top). Examples: "TYPE 1.1A (ADA)", "TYPE 2.1B-AS", "STUDIO", etc. Extract the EXACT and COMPLETE name. If none visible, use "".

2. Extract ONLY vanity tops (bathroom tops). Ignore all kitchen countertops. Vanity tops are identified by:
   - Depth of 22" or less (commonly 22", 19", 18")
   - Labels mentioning "vanity", "bath", "lav", "powder"
   - Typically have an oval or round bowl cutout drawn
   - Boxed/separate from kitchen countertop runs

3. For EACH vanity top, extract:
   a. **length** — total length in inches (e.g., 47.5, 31, 25)
   b. **depth** — depth in inches (usually 22")
   c. **bowlPosition** — examine the bowl cutout location:
      - If the bowl is NOT centered horizontally, it is "offset". Determine which side it is closer to:
        - "offset-left" if bowl center is closer to the left edge
        - "offset-right" if bowl center is closer to the right edge
      - If the bowl is centered horizontally (equal distance from both edges), it is "center"
   d. **bowlOffset** — if offset, measure the distance in inches from the CLOSER edge to the center of the bowl. This is usually dimensioned in the drawing (e.g., 17.75" from left edge). If center, set to null.
   e. **leftWall** — true if the LEFT side of the vanity top shows a DOUBLE LINE (two parallel lines close together) at the left edge. Double lines indicate the vanity is against a wall on that side, which means there would be a sidesplash. A single line means an open/exposed edge.
   f. **rightWall** — true if the RIGHT side shows a DOUBLE LINE at the right edge. Same logic as leftWall.
   
RULES FOR WALL DETECTION (CRITICAL):
- A DOUBLE LINE (two parallel lines very close together, ~0.5-1" apart) at the edge of a vanity top means there is a WALL on that side.
- A SINGLE LINE at the edge means the edge is OPEN (exposed/finished).
- Look carefully at both the LEFT and RIGHT short edges of the rectangular vanity drawing.
- The backsplash (back wall) is typically always present — focus on detecting LEFT and RIGHT wall indicators.
- Double lines = sidesplash present on that side.
- If a faint second parallel line is present, treat it as a DOUBLE LINE (prefer wall=true over false-negative).

RULES FOR BOWL POSITION:
- Look for dimension lines showing the distance from the vanity edge to the bowl centerline.
- If the drawing shows a measurement like "17 3/4"" from one side, that's the bowlOffset.
- If both sides have equal dimensions to the bowl center, it's "center".
- Convert fractions to decimals: 3/4 = 0.75, 1/2 = 0.5, 1/4 = 0.25, 3/8 = 0.375

IMPORTANT:
- Only extract vanity/bathroom tops. Skip ALL kitchen countertops (depth > 22").
- If the page has no vanity tops, return {"unitTypeName":"","vtops":[]}
- Round all dimensions to nearest 0.25 inch.

Return ONLY valid JSON — no markdown fences, no explanation:
{"unitTypeName":"TYPE 1.1A (ADA)","vtops":[{"length":47.5,"depth":22,"bowlPosition":"offset-left","bowlOffset":17.75,"leftWall":true,"rightWall":true}]}`;
    const stripPrompt = `You are analyzing a cropped strip of a 2020 countertop shop drawing page.

TASK:
- Extract ONLY vanity tops visible in this cropped image (ignore kitchen tops).
- For each vanity top, return: length, depth, bowlPosition, bowlOffset, leftWall, rightWall.

WALL DETECTION (VERY IMPORTANT):
- Double/parallel lines at a vanity edge mean WALL on that side (leftWall/rightWall = true).
- Even a faint second parallel line should be treated as a wall indicator.
- Single line means open edge.

Return ONLY valid JSON:
{"vtops":[{"length":47.5,"depth":22,"bowlPosition":"offset-left","bowlOffset":17.75,"leftWall":true,"rightWall":true}]}`;

    let fullContent = "";
    try {
      fullContent = await requestGemini(
        GEMINI_API_KEY,
        pageImage,
        fullPrompt,
        PRIMARY_MODELS,
        { temperature: 0.1, maxOutputTokens: 4096 },
      );
    } catch (err) {
      if (err instanceof Error && err.message === "rate_limit") {
        return new Response(JSON.stringify({ error: "rate_limit" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (err instanceof Error && err.message === "credits") {
        return new Response(JSON.stringify({ error: "credits" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (err instanceof Error && err.message === "ai_unavailable") {
        return new Response(JSON.stringify({ error: "AI model temporarily unavailable.", unitTypeName: "", vtops: [] }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      throw err;
    }

    console.log("AI vtop raw:", fullContent.slice(0, 800));

    const fullParsed = parseExtractionText(fullContent);
    const unitTypeName = fullParsed.unitTypeName;
    console.log("Detected unit type name:", unitTypeName);

    let vtops = fullParsed.vtops;

    if (safeStripImages.length > 0 && vtops.length > 0) {
      const stripResults = await Promise.all(
        safeStripImages.map(async (stripImage, index) => {
          try {
            const stripContent = await requestGemini(
              GEMINI_API_KEY,
              stripImage,
              stripPrompt,
              STRIP_MODELS,
              { temperature: 0.1, maxOutputTokens: 2048 },
            );
            const parsed = parseExtractionText(stripContent);
            console.log(`Strip ${index + 1} rows:`, parsed.vtops.length);
            return parsed.vtops;
          } catch (err) {
            console.warn(`Strip pass ${index + 1} failed:`, err);
            return [] as VtopRow[];
          }
        }),
      );

      vtops = mergeWallEvidence(vtops, stripResults.filter(set => set.length > 0));
    }

    return new Response(JSON.stringify({ unitTypeName, vtops }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("extract-pdf-vtops error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
