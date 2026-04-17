import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type VtopBbox = { x: number; y: number; width: number; height: number };
type PageSide = "top" | "bottom" | "left" | "right";
type CloserEndOnPage = PageSide | "center";

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
  backSideOnPage?: PageSide;
  closerEndOnPage?: CloserEndOnPage;
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

function normalizePageSide(value: unknown): PageSide | undefined {
  const v = String(value || "").trim().toLowerCase();
  if (v === "top" || v === "bottom" || v === "left" || v === "right") return v;
  return undefined;
}

function normalizeCloserEnd(value: unknown): CloserEndOnPage | undefined {
  const v = String(value || "").trim().toLowerCase();
  if (v === "center") return "center";
  return normalizePageSide(v);
}

function resolveBowlPositionFromPageSides(
  backSideOnPage?: PageSide,
  closerEndOnPage?: CloserEndOnPage,
): "offset-left" | "offset-right" | "center" | undefined {
  if (!backSideOnPage || !closerEndOnPage) return undefined;
  if (closerEndOnPage === "center") return "center";

  if (backSideOnPage === "top") {
    if (closerEndOnPage === "left") return "offset-left";
    if (closerEndOnPage === "right") return "offset-right";
  }
  if (backSideOnPage === "bottom") {
    if (closerEndOnPage === "left") return "offset-right";
    if (closerEndOnPage === "right") return "offset-left";
  }
  if (backSideOnPage === "left") {
    if (closerEndOnPage === "top") return "offset-right";
    if (closerEndOnPage === "bottom") return "offset-left";
  }
  if (backSideOnPage === "right") {
    if (closerEndOnPage === "top") return "offset-left";
    if (closerEndOnPage === "bottom") return "offset-right";
  }

  return undefined;
}

function normalizeVtop(vt: any): VtopRow {
  const length = Math.round((Number(vt?.length) || 31) * 4) / 4;
  const depth = Math.round((Number(vt?.depth) || 22) * 4) / 4;
  const backSideOnPage = normalizePageSide(vt?.backSideOnPage);
  const closerEndOnPage = normalizeCloserEnd(vt?.closerEndOnPage);
  const resolvedBowlPosition = resolveBowlPositionFromPageSides(backSideOnPage, closerEndOnPage);
  const bowlPosition = resolvedBowlPosition || (["offset-left", "offset-right", "center"].includes(vt?.bowlPosition)
    ? vt.bowlPosition
    : "center");
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
    backSideOnPage,
    closerEndOnPage,
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

// ── Dialagram (OpenAI-compatible Qwen) ──
const DIALAGRAM_BASE_URL = "https://www.dialagram.me/router/v1";

async function requestDialagram(
  apiKey: string,
  images: Array<{ mimeType: string; data: string }>,
  prompt: string,
  model: string,
  temperature: number,
  maxTokens: number,
): Promise<string> {
  const MAX_RETRIES = 3;
  const imageParts = images.map((img) => ({
    type: "image_url" as const,
    image_url: { url: `data:${img.mimeType};base64,${img.data}` },
  }));

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt === 0) {
      const totalBytes = images.reduce((s, i) => s + i.data.length, 0);
      console.log(`Dialagram request: model=${model}, images=${images.length}, total base64 bytes=${totalBytes}`);
    }
    let response: Response;
    try {
      response = await fetch(`${DIALAGRAM_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature,
          max_tokens: maxTokens,
          stream: false,
          messages: [
            {
              role: "system",
              content: "You are a vision AI that analyzes architectural shop drawings provided as images. Always examine the attached image(s) carefully before responding. Never ask the user to upload an image — the images are always attached.",
            },
            {
              role: "user",
              content: [{ type: "text", text: prompt }, ...imageParts],
            },
          ],
        }),
      });
    } catch (fetchErr) {
      console.error(`Dialagram fetch error (attempt ${attempt + 1}):`, fetchErr);
      if (attempt < MAX_RETRIES - 1) { await new Promise(r => setTimeout(r, 2000 * (attempt + 1))); continue; }
      throw new Error("ai_unavailable");
    }

    if (response.status === 429) throw new Error("rate_limit");
    if (response.status === 402) throw new Error("credits");
    if (response.status === 503 || response.status === 500) {
      console.warn(`Dialagram unavailable (${response.status}), attempt ${attempt + 1}/${MAX_RETRIES}`);
      if (attempt < MAX_RETRIES - 1) { await new Promise(r => setTimeout(r, 2000 * (attempt + 1))); continue; }
      throw new Error("ai_unavailable");
    }
    if (!response.ok) {
      const errText = await response.text();
      console.error("Dialagram error:", response.status, errText);
      throw new Error(`AI error: ${response.status}`);
    }
    return await parseDialagramResponse(response);
  }
  throw new Error("ai_unavailable");
}

// Parse Dialagram response — handles both standard JSON and SSE streaming format.
async function parseDialagramResponse(response: Response): Promise<string> {
  const raw = await response.text();
  const trimmed = raw.trim();

  if (trimmed.startsWith("{")) {
    try {
      const data = JSON.parse(trimmed);
      return data.choices?.[0]?.message?.content ?? "";
    } catch (err) {
      console.error("Dialagram JSON parse failed:", err, "raw:", trimmed.slice(0, 300));
      throw new Error("ai_unavailable");
    }
  }

  if (trimmed.startsWith("data:")) {
    let assembled = "";
    const lines = raw.split("\n");
    for (const line of lines) {
      const l = line.trim();
      if (!l.startsWith("data:")) continue;
      const payload = l.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const chunk = JSON.parse(payload);
        const delta = chunk.choices?.[0]?.delta?.content
          ?? chunk.choices?.[0]?.message?.content
          ?? "";
        if (delta) assembled += delta;
      } catch {
        // skip non-JSON SSE lines
      }
    }
    if (assembled) return assembled;
    console.error("Dialagram SSE returned no content. Raw:", raw.slice(0, 500));
    throw new Error("ai_unavailable");
  }

  console.error("Dialagram returned unexpected format:", raw.slice(0, 300));
  throw new Error("ai_unavailable");
}

async function callAI(
  provider: "gemini" | "dialagram",
  images: Array<{ mimeType: string; data: string }>,
  prompt: string,
  opts: { temperature: number; maxOutputTokens: number; geminiModels: ModelAttempt[]; dialagramModel: string },
): Promise<string> {
  if (provider === "dialagram") {
    const key = Deno.env.get("DIALAGRAM_API_KEY");
    if (!key) throw new Error("DIALAGRAM_API_KEY not configured");
    return requestDialagram(key, images, prompt, opts.dialagramModel, opts.temperature, opts.maxOutputTokens);
  }
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) throw new Error("GEMINI_API_KEY not configured");
  return requestGemini(key, images, prompt, opts.geminiModels, { temperature: opts.temperature, maxOutputTokens: opts.maxOutputTokens });
}
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const { pageImage, focusedWallDetection, rightEndCrop, provider: providerInput, dialagramModel: dialagramModelInput } = body;
    const provider: "gemini" | "dialagram" = providerInput === "dialagram" ? "dialagram" : "gemini";
    const dialagramModel = String(dialagramModelInput || "qwen-3.6-plus");
    console.log(`extract-pdf-vtops provider=${provider}${provider === "dialagram" ? ` model=${dialagramModel}` : ""}`);

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
        const content = await callAI(
          provider,
          [
            { mimeType: "image/png", data: pageImage },
            { mimeType: "image/png", data: rightEndCrop },
          ],
          focusedPrompt,
          {
            temperature: 0.1,
            maxOutputTokens: 256,
            geminiModels: [{ name: "gemini-3-flash-preview", retries: 2 }],
            dialagramModel,
          },
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
   c. **backSideOnPage** — which PAGE SIDE contains the backsplash / back edge (double line along the long edge). Must be exactly one of: "top", "bottom", "left", "right".
   d. **closerEndOnPage** — which PAGE SIDE contains the SHORTER bowl-center dimension along the LENGTH axis. Must be exactly one of: "top", "bottom", "left", "right", or "center".
   e. **bowlPosition** — determine left vs right FROM THE PERSPECTIVE OF A PERSON STANDING IN FRONT OF THE VANITY, FACING IT.
      CRITICAL PERSPECTIVE RULE:
        1. The BACKSPLASH / WALL (double line along the long edge) is BEHIND the vanity — this is the BACK.
        2. Imagine a person standing in FRONT of the vanity (opposite the backsplash), facing toward it.
        3. LEFT and RIGHT are from THIS person's perspective.
        4. Find the dimension callouts showing distance from each end of the LENGTH axis to the bowl center.
        5. The end with the SHORTER dimension is the side the bowl is offset toward.
        6. Use backSideOnPage + closerEndOnPage consistently to determine bowlPosition.
      ORIENTATION HANDLING:
        - If the vanity is drawn HORIZONTALLY (wider than tall on page): backsplash is usually at top. Person stands at bottom facing up. Person's left = page left, right = page right.
        - If the vanity is drawn VERTICALLY (taller than wide on page): backsplash is usually on one side. Person stands on the opposite side facing the backsplash.
        - IMPORTANT vertical rule: if the backsplash/back is on PAGE RIGHT, the person stands on PAGE LEFT; then PERSON LEFT = PAGE TOP and PERSON RIGHT = PAGE BOTTOM.
        - IMPORTANT vertical rule: if the backsplash/back is on PAGE LEFT, the person stands on PAGE RIGHT; then PERSON LEFT = PAGE BOTTOM and PERSON RIGHT = PAGE TOP.
        - ALWAYS check where the backsplash/wall double-line is to establish the "back" first.
      - "offset-left" if bowl is closer to the person's LEFT end
      - "offset-right" if bowl is closer to the person's RIGHT end
      - "center" if bowl is centered along the length axis
   f. **bowlOffset** — if offset, measure the distance in inches from the CLOSER end to the center of the bowl. If center, set to null.
   g. **leftWall** and **rightWall** — CRITICAL: Detect whether each end of the vanity top has a wall, using the SAME "person standing in front" perspective.
      leftWall = wall on the person's LEFT end. rightWall = wall on the person's RIGHT end.

RULES FOR WALL DETECTION (leftWall / rightWall):
- Use the SAME "person standing in front" perspective as bowlPosition.
- Look at EACH END of the vanity top along its LENGTH axis.
- WALL (true) indicators — any of these means the end has a wall:
  * DOUBLE PARALLEL LINES at the end edge (two lines close together = sidesplash/wall return)
  * A WALL LINE drawn adjacent to and touching the vanity end
  * The vanity end butts against a wall line in the floor plan
  * A sidesplash or backsplash return is shown at that end
  * Text labels like "SS" (sidesplash), "WALL", or hatching at the end
- OPEN / NO WALL (false) indicators:
  * SINGLE LINE at the end edge (just the vanity outline = finish end / open end)
  * The vanity end is free-standing with no wall nearby
  * Text labels like "FE" (finish end) or "OPEN"
- MOST vanity tops in residential projects have BOTH walls (leftWall=true AND rightWall=true). This is the DEFAULT expectation.
- Only set a wall to false if you see a CLEAR single line with NO adjacent wall structure.
- If you see double lines at BOTH ends, set BOTH leftWall and rightWall to true.
- In 2020 shop drawings, vanity tops between two walls in a bathroom alcove will have wall indicators (double lines or sidesplash marks) at BOTH ends.
- Set leftWallYesConfidence and rightWallYesConfidence to reflect your certainty (0.0=definitely no wall, 1.0=definitely wall).
- BIAS: Default to true (wall). Only set false when you are VERY confident there is no wall. Most vanities are installed in alcoves with walls on both sides.

RULES FOR BOWL POSITION:
- ALWAYS use dimension callout lines to determine offset — do not guess from visual position alone.
- Look for dimension lines showing the distance from the vanity edge to the bowl centerline.
- The SMALLER dimension value indicates which end the bowl is offset toward.
- If the drawing shows a measurement like "17 3/4\"" from one side and "29 3/4\"" from the other, the bowl is offset toward the 17 3/4" side.
- If both sides have equal dimensions to the bowl center, it's "center".
- Convert fractions to decimals: 3/4 = 0.75, 1/2 = 0.5, 1/4 = 0.25, 3/8 = 0.375
- For TYPE 1.1B-AS style vertical views: if the backsplash double-line is on PAGE LEFT and the shorter offset dimension (17.75") is from PAGE BOTTOM, the correct answer is backSideOnPage="left", closerEndOnPage="bottom", bowlPosition="offset-left".

IMPORTANT:
- Only extract vanity/bathroom tops. Skip ALL kitchen countertops (depth > 22").
- If the page has no vanity tops, return {"unitTypeName":"","vtops":[]}
- Round all dimensions to nearest 0.25 inch.
- The bbox coordinates MUST be normalized 0..1 relative to the full page.

Return ONLY valid JSON — no markdown fences, no explanation:
{"unitTypeName":"TYPE 1.1A (ADA)","vtops":[{"length":47.5,"depth":22,"backSideOnPage":"left","closerEndOnPage":"bottom","bowlPosition":"offset-left","bowlOffset":17.75,"leftWall":true,"rightWall":true,"leftWallYesConfidence":0.9,"rightWallYesConfidence":0.85,"bbox":{"x":0.05,"y":0.3,"width":0.35,"height":0.2}}]}`;

    // ── Pass 1: Extraction ──
    let fullContent = "";
    try {
      fullContent = await callAI(
        provider,
        [{ mimeType: "image/jpeg", data: pageImage }],
        fullPrompt,
        {
          temperature: 0.1,
          maxOutputTokens: 4096,
          geminiModels: PRIMARY_MODELS,
          dialagramModel,
        },
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

Look at the SAME shop drawing image and verify EACH item carefully:
1. Is the unitTypeName correct? If not, provide the correct one.
2. Are the dimensions (length, depth) accurate? Correct any errors.
3. **CRITICAL — RE-CHECK bowlPosition using "person standing in front" perspective:**
   - Find the BACKSPLASH (double line along long edge) — that is the BACK of the vanity.
   - Return that as backSideOnPage = "top" | "bottom" | "left" | "right".
   - Find which PAGE SIDE has the SHORTER bowl-center dimension along the LENGTH axis.
   - Return that as closerEndOnPage = "top" | "bottom" | "left" | "right" | "center".
   - Then make bowlPosition consistent with those fields.
   - IMPORTANT vertical rule: if backSideOnPage="right" and closerEndOnPage="top", bowlPosition MUST be "offset-left".
4. Is the bowlOffset value accurate?
5. Are there any MISSING vanity tops not extracted? Add them.
6. Are there any FALSE vanity tops (actually kitchen countertops with depth > 22")? Remove them.

7. **CRITICAL — RE-CHECK WALL DETECTION using the SAME "person standing in front" perspective:**
   - leftWall = wall on the person's LEFT end. rightWall = wall on the person's RIGHT end.
   - DOUBLE LINES at an end = WALL (sidesplash). Set leftWall/rightWall to true.
   - SINGLE LINE at an end = OPEN (finish end). Set leftWall/rightWall to false.
   - MOST vanity tops have BOTH walls (leftWall=true AND rightWall=true). This is the DEFAULT.
   - Only set false when you see a CLEAR single line with no wall structure nearby.
   - BIAS toward true (wall) — false negatives are worse than false positives.
   - Update leftWallYesConfidence and rightWallYesConfidence accordingly.

Return the CORRECTED complete JSON — same format:
{"unitTypeName":"...","vtops":[...]}

If everything looks correct, return the data as-is. Return ONLY valid JSON — no markdown fences, no explanation.`;

      try {
        const verifyContent = await callAI(
          provider,
          [{ mimeType: "image/jpeg", data: pageImage }],
          verifyPrompt,
          {
            temperature: 0.1,
            maxOutputTokens: 4096,
            geminiModels: VERIFY_MODELS,
            dialagramModel,
          },
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
