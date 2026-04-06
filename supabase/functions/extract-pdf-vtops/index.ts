import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type VtopBbox = { x: number; y: number; width: number; height: number };

type VtopRow = {
  length: number;
  depth: number;
  bowlPosition: "offset-left" | "offset-right" | "center";
  bowlOffset: number | null;
  leftWall: boolean;
  rightWall: boolean;
  bbox?: VtopBbox;
  aiLeftWallHint?: boolean;
  aiRightWallHint?: boolean;
  leftWallYesConfidence?: number;
  rightWallYesConfidence?: number;
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
  { name: "gemini-2.5-flash", retries: 2 },
];

const VERIFY_MODELS: ModelAttempt[] = [
  { name: "gemini-3-flash-preview", retries: 2 },
];

function clampNorm(v: number): number {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

function normalizeVtop(vt: any): VtopRow {
  const length = Math.round((Number(vt?.length) || 31) * 4) / 4;
  const depth = Math.round((Number(vt?.depth) || 22) * 4) / 4;
  const bowlPosition = ["offset-left", "offset-right", "center"].includes(vt?.bowlPosition)
    ? vt.bowlPosition
    : "center";
  const bowlOffset = bowlPosition !== "center"
    ? Math.round((Number(vt?.bowlOffset) || 0) * 4) / 4
    : null;

  const aiLeft = Boolean(vt?.leftWall);
  const aiRight = Boolean(vt?.rightWall);

  const row: VtopRow = {
    length,
    depth,
    bowlPosition,
    bowlOffset,
    leftWall: aiLeft,
    rightWall: aiRight,
    aiLeftWallHint: aiLeft,
    aiRightWallHint: aiRight,
    leftWallYesConfidence: Math.max(0, Math.min(1, Number(vt?.leftWallYesConfidence) || 0.5)),
    rightWallYesConfidence: Math.max(0, Math.min(1, Number(vt?.rightWallYesConfidence) || 0.5)),
  };

  if (vt?.bbox && typeof vt.bbox === "object") {
    row.bbox = {
      x: clampNorm(vt.bbox.x),
      y: clampNorm(vt.bbox.y),
      width: clampNorm(vt.bbox.width),
      height: clampNorm(vt.bbox.height),
    };
    if (row.bbox.width < 0.01 || row.bbox.height < 0.01) {
      row.bbox = undefined;
    }
  }

  return row;
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

function parseWallConfidence(content: string): { leftWallYesConfidence: number; rightWallYesConfidence: number } {
  try {
    let cleaned = content
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) cleaned = cleaned.slice(start, end + 1);
    const parsed = JSON.parse(cleaned);
    return {
      leftWallYesConfidence: Math.max(0, Math.min(1, Number(parsed?.leftWallYesConfidence) || 0.5)),
      rightWallYesConfidence: Math.max(0, Math.min(1, Number(parsed?.rightWallYesConfidence) || 0.5)),
    };
  } catch {
    return { leftWallYesConfidence: 0.5, rightWallYesConfidence: 0.5 };
  }
}

async function requestGemini(
  apiKey: string,
  images: Array<{ mimeType: string; data: string }>,
  prompt: string,
  models: ModelAttempt[],
  generationConfig: { temperature: number; maxOutputTokens: number },
): Promise<string> {
  let response: Response | null = null;

  const imageParts = images.map(img => ({
    inlineData: { mimeType: img.mimeType, data: img.data },
  }));

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
                  ...imageParts,
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

    const body = await req.json();
    const { pageImage, focusedWallDetection, rightEndCrop } = body;

    if (!pageImage || typeof pageImage !== "string") {
      return new Response(JSON.stringify({ error: "pageImage (base64 string) required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Mode 2: Focused wall detection on end crops ──
    if (focusedWallDetection && rightEndCrop) {
      console.log("Focused wall detection mode");
      const focusedPrompt = `You are analyzing two cropped images of the left and right ends of a vanity top from a 2020 countertop shop drawing.

TASK: Determine if each end has a WALL (double line / sidesplash) or is OPEN (single line / finish end).

Image 1 = LEFT end of the vanity
Image 2 = RIGHT end of the vanity

Wall indicators:
- Double parallel lines at the edge = WALL (sidesplash needed)
- Single line at the edge = OPEN (finish end needed)
- A wall adjacent to the vanity = WALL

Return ONLY valid JSON:
{"leftWallYesConfidence":0.85,"rightWallYesConfidence":0.2}

leftWallYesConfidence: probability 0.0-1.0 that the LEFT end has a wall
rightWallYesConfidence: probability 0.0-1.0 that the RIGHT end has a wall`;

      try {
        const content = await requestGemini(
          GEMINI_API_KEY,
          [
            { mimeType: "image/png", data: pageImage },
            { mimeType: "image/png", data: rightEndCrop },
          ],
          focusedPrompt,
          [{ name: "gemini-3-flash-preview", retries: 2 }],
          { temperature: 0.1, maxOutputTokens: 256 },
        );
        console.log("Focused wall raw:", content);
        const result = parseWallConfidence(content);
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (err) {
        if (err instanceof Error && err.message === "rate_limit") {
          return new Response(JSON.stringify({ error: "rate_limit" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        return new Response(JSON.stringify({ leftWallYesConfidence: 0.5, rightWallYesConfidence: 0.5 }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // ── Mode 1: Full-page extraction (dimensions, bbox, rough wall hints) ──
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
   c. **bowlPosition** — examine the bowl cutout location relative to the vanity's LENGTH (long dimension):
      CRITICAL ORIENTATION NOTE: Vanity tops may be drawn VERTICALLY on the page (rotated 90°).
      If the vanity rectangle is taller than wide on the page, it is rotated — "left" and "right" refer to the vanity's own long-axis ends, NOT page-left/page-right.
      To determine left vs right:
        1. Identify the vanity's LENGTH axis (the longer dimension, e.g., 47.5").
        2. Look at dimension callouts that show the distance from each end of the LENGTH axis to the bowl center.
        3. The end with the SHORTER dimension is the side the bowl is offset toward.
        4. Use the vanity's installed orientation: typically the LENGTH runs left-to-right as viewed in the plan. If the vanity is drawn vertically, the TOP of the drawing = LEFT end, BOTTOM = RIGHT end (standard drafting convention).
      - "offset-left" if bowl center is closer to the LEFT end of the length axis
      - "offset-right" if bowl center is closer to the RIGHT end of the length axis
      - "center" if bowl is centered along the length axis
   d. **bowlOffset** — if offset, measure the distance in inches from the CLOSER end to the center of the bowl. If center, set to null.

RULES FOR BOWL POSITION:
- ALWAYS use dimension callout lines to determine offset — do not guess from visual position alone.
- Look for dimension lines showing the distance from the vanity edge to the bowl centerline.
- The SMALLER dimension value indicates which end the bowl is offset toward.
- If the drawing shows a measurement like "17 3/4"" from one side and "29 3/4"" from the other, the bowl is offset toward the 17 3/4" side.
- If both sides have equal dimensions to the bowl center, it's "center".
- Convert fractions to decimals: 3/4 = 0.75, 1/2 = 0.5, 1/4 = 0.25, 3/8 = 0.375

IMPORTANT:
- Only extract vanity/bathroom tops. Skip ALL kitchen countertops (depth > 22").
- If the page has no vanity tops, return {"unitTypeName":"","vtops":[]}
- Round all dimensions to nearest 0.25 inch.
- The bbox coordinates MUST be normalized 0..1 relative to the full page.

Return ONLY valid JSON — no markdown fences, no explanation:
{"unitTypeName":"TYPE 1.1A (ADA)","vtops":[{"length":47.5,"depth":22,"bowlPosition":"offset-right","bowlOffset":17.75,"leftWall":true,"rightWall":false,"leftWallYesConfidence":0.85,"rightWallYesConfidence":0.1,"bbox":{"x":0.05,"y":0.3,"width":0.35,"height":0.2}}]}`;

    // ── Pass 1: Extraction ──
    let fullContent = "";
    try {
      fullContent = await requestGemini(
        GEMINI_API_KEY,
        [{ mimeType: "image/jpeg", data: pageImage }],
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
    const extractedUnitTypeName = fullParsed.unitTypeName;
    console.log("Detected unit type name:", extractedUnitTypeName);

    let finalVtops = fullParsed.vtops;
    let finalUnitTypeName = extractedUnitTypeName;

    // ── Pass 2: Verification ──
    if (finalVtops.length > 0) {
      console.log("Starting vtop verification pass...");
      const verifyPrompt = `You are verifying AI-extracted vanity top data from a 2020 shop drawing.

Here is the extracted data:
${JSON.stringify({ unitTypeName: extractedUnitTypeName, vtops: finalVtops }, null, 2)}

Look at the SAME shop drawing image and verify:
1. Is the unitTypeName correct? If not, provide the correct one.
2. Are the dimensions (length, depth) accurate? Correct any errors.
3. Is the bowlPosition correct? Check dimension callouts for bowl offset direction.
4. Is the bowlOffset value accurate?
5. Are there any MISSING vanity tops not extracted? Add them.
6. Are there any FALSE vanity tops (actually kitchen countertops)? Remove them.

Return the CORRECTED complete JSON — same format:
{"unitTypeName":"...","vtops":[...]}

If everything looks correct, return the data as-is. Return ONLY valid JSON — no markdown fences, no explanation.`;

      try {
        const verifyContent = await requestGemini(
          GEMINI_API_KEY,
          [{ mimeType: "image/jpeg", data: pageImage }],
          verifyPrompt,
          VERIFY_MODELS,
          { temperature: 0.1, maxOutputTokens: 4096 },
        );
        console.log("Verify vtop raw:", verifyContent.slice(0, 800));
        const verified = parseExtractionText(verifyContent);

        if (verified.vtops && verified.vtops.length > 0) {
          finalVtops = verified.vtops;
          finalUnitTypeName = (verified.unitTypeName || extractedUnitTypeName).trim();
          console.log("Verified vtop unit type:", finalUnitTypeName, "vtops:", finalVtops.length);
        }
      } catch (verifyErr) {
        console.warn("Vtop verification pass failed, using extraction result:", verifyErr);
      }
    }

    const vtops = finalVtops.map(row => ({
      ...row,
      leftWallYesConfidence: row.leftWallYesConfidence ?? 0.5,
      rightWallYesConfidence: row.rightWallYesConfidence ?? 0.5,
      sidesplashCount: (row.leftWall ? 1 : 0) + (row.rightWall ? 1 : 0),
      reviewRequired: true,
      reviewReason: "Wall hints are rough — will be refined by local detector.",
    }));

    return new Response(JSON.stringify({ unitTypeName: finalUnitTypeName, vtops }), {
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
