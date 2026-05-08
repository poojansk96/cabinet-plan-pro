import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type ModelAttempt = { name: string; retries: number };

type NormalizedCountertop = {
  label: string;
  roomName?: string;
  instanceKey?: string;
  length: number | null;
  depth: number | null;
  backsplashLength: number | null;
  isIsland: boolean;
  category: "kitchen" | "bath";
};

type CountertopPassResult = {
  unitTypeName: string;
  countertops: NormalizedCountertop[];
  raw: string;
};

const PRIMARY_MODELS: ModelAttempt[] = [
  { name: "gemini-3.1-flash-lite-preview", retries: 3 },
  { name: "gemini-3-flash-preview", retries: 2 },
];

const VERIFY_MODELS: ModelAttempt[] = [
  { name: "gemini-3.1-flash-lite-preview", retries: 2 },
];

async function requestGemini(
  apiKey: string,
  imageData: string,
  imageMimeType: string,
  prompt: string,
  models: ModelAttempt[],
  generationConfig: { temperature: number; maxOutputTokens: number },
): Promise<string> {
  let response: Response | null = null;

  for (const { name: model, retries } of models) {
    console.log(`Trying Gemini model: ${model} (${retries} attempts)`);
    let succeeded = false;

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ role: "user", parts: [
                { inlineData: { mimeType: imageMimeType, data: imageData } },
                { text: prompt },
              ]}],
              generationConfig,
            }),
          }
        );
      } catch (fetchErr) {
        console.error(`AI fetch error (${model}, attempt ${attempt + 1}):`, fetchErr);
        if (attempt < retries - 1) { await new Promise(r => setTimeout(r, 2000 * (attempt + 1))); continue; }
        response = null;
        break;
      }

      if (response.status === 429) throw new Error("rate_limit");
      if (response.status === 402) throw new Error("credits");

      if (response.status === 503 || response.status === 500) {
        console.warn(`AI unavailable (${response.status}) for ${model}, attempt ${attempt + 1}/${retries}`);
        response = null;
        if (attempt < retries - 1) { await new Promise(r => setTimeout(r, 2000 * (attempt + 1))); continue; }
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
  imageData: string,
  imageMimeType: string,
  prompt: string,
  model: string,
  temperature: number,
  maxTokens: number,
): Promise<string> {
  const MAX_RETRIES = 3;
  let response: Response | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt === 0) {
      console.log(`Dialagram request: model=${model}, mime=${imageMimeType}, image bytes (base64)=${imageData.length}`);
    }
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
              content: "You are a vision AI that analyzes architectural shop drawings provided as images. Always inspect the attached image before responding. Never say no image was uploaded, because the image is always attached.",
            },
            {
              role: "user",
              content: [
                { type: "text", text: prompt },
                {
                  type: "image_url",
                  image_url: { url: `data:${imageMimeType};base64,${imageData}` },
                },
              ],
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
  imageData: string,
  imageMimeType: string,
  prompt: string,
  opts: { temperature: number; maxOutputTokens: number; geminiModels: ModelAttempt[]; dialagramModel: string },
): Promise<string> {
  if (provider === "dialagram") {
    const key = Deno.env.get("DIALAGRAM_API_KEY");
    if (!key) throw new Error("DIALAGRAM_API_KEY not configured");
    return requestDialagram(key, imageData, imageMimeType, prompt, opts.dialagramModel, opts.temperature, opts.maxOutputTokens);
  }
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) throw new Error("GEMINI_API_KEY not configured");
  return requestGemini(key, imageData, imageMimeType, prompt, opts.geminiModels, { temperature: opts.temperature, maxOutputTokens: opts.maxOutputTokens });
}

function buildKnownAIErrorResponse(err: unknown): Response | null {
  if (err instanceof Error && err.message === "rate_limit") {
    return new Response(JSON.stringify({ error: "rate_limit" }), {
      status: 429,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (err instanceof Error && err.message === "credits") {
    return new Response(JSON.stringify({ error: "credits" }), {
      status: 402,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  if (err instanceof Error && err.message === "ai_unavailable") {
    return new Response(JSON.stringify({ error: "AI model temporarily unavailable.", unitTypeName: "", countertops: [] }), {
      status: 503,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
  return null;
}

// ── Extract printed dimension values from raw page text (PDF text layer) ──
// Returns numeric inch values (decimals) printed as labels on the drawing.
// Used as ground truth for Qwen anchoring + post-extraction validation.
function extractPrintedDimensionsFromPageText(text: string): number[] {
  if (!text) return [];
  const cleaned = String(text).replace(/[\u00A0]/g, " ");
  const found = new Set<number>();
  // Handle "76 1/2"" or "25 1/4"" or "129"" or "47 1/2"" — quote may be missing
  // Patterns:
  // - whole + space + fraction: "76 1/2"
  // - whole only: "129"
  // - just fraction: "1/2"
  const pattern = /(\d+)\s*(?:(\d)\s*\/\s*(\d))?\s*"/g;
  let m: RegExpExecArray | null;
  while ((m = pattern.exec(cleaned)) !== null) {
    const whole = parseInt(m[1], 10);
    let value = whole;
    if (m[2] && m[3]) {
      const num = parseInt(m[2], 10);
      const den = parseInt(m[3], 10);
      if (den > 0) value += num / den;
    }
    if (value >= 6 && value <= 600) {
      found.add(Math.round(value * 4) / 4); // round to nearest 1/4"
    }
  }
  // Also handle stacked fractions like "76\n12\n" (where 12 is over 2 implicitly) — common in 2020 drawings
  // Pattern: number, newline/space, "1 2" or "1 4" or "3 4" sequences (PDF text fragmentation)
  const stackedPattern = /(\d+)\s+(?:1\s*4|1\s*2|3\s*4)\s*"/g;
  let s: RegExpExecArray | null;
  while ((s = stackedPattern.exec(cleaned)) !== null) {
    const whole = parseInt(s[1], 10);
    const frag = s[0].replace(/[^\d]/g, "");
    let frac = 0;
    if (frag.endsWith("14")) frac = 0.25;
    else if (frag.endsWith("12")) frac = 0.5;
    else if (frag.endsWith("34")) frac = 0.75;
    const value = whole + frac;
    if (value >= 6 && value <= 600) found.add(Math.round(value * 4) / 4);
  }
  return Array.from(found).sort((a, b) => a - b);
}

function formatDimensionForPrompt(n: number): string {
  if (Number.isInteger(n)) return `${n}"`;
  const whole = Math.floor(n);
  const frac = n - whole;
  if (frac === 0.25) return `${whole} 1/4"`;
  if (frac === 0.5) return `${whole} 1/2"`;
  if (frac === 0.75) return `${whole} 3/4"`;
  return `${n}"`;
}

// Returns true if the value (or a near-by ±0.5 variant) appears in the printed dimensions list.
function isDimensionPrinted(value: number | null, printed: number[]): boolean {
  if (value == null || !printed.length) return true; // can't validate -> permit
  return printed.some((p) => Math.abs(p - value) <= 0.5);
}

function buildCountertopExtractionPrompt(provider: "gemini" | "dialagram", printedDims: number[] = []): string {
  const dimsBlock = printedDims.length
    ? `\n\nGROUND-TRUTH DIMENSIONS PRINTED ON THIS IMAGE (extracted from the PDF text layer):\n${printedDims.map(formatDimensionForPrompt).join(", ")}\nEvery length / depth / backsplashLength you return MUST come from this list (or be a sum of values from this list for L-shaped run totals). Do NOT invent values that are not in this list.\n`
    : "";

  if (provider === "dialagram") {
    return `You are a millwork estimator looking at ONE 2020 countertop shop drawing image.${dimsBlock}

CRITICAL — READ DIMENSIONS FROM THIS IMAGE ONLY:
- DO NOT invent or guess any number. Every length / depth / backsplashLength MUST come from a dimension label literally printed on THIS image.
- Dimensions in the drawing are written in inches with fraction notation like 76 1/2", 25 1/4", 39 3/4", 47 1/2". Convert fractions to decimals (1/4=0.25, 1/2=0.5, 3/4=0.75).
- If you cannot find a printed dimension for a value, return null for that field. NEVER use 96, 108, 120, 60, 72, 36, 25.5 as a "safe default" — those are forbidden defaults unless that exact number is printed on the image.
- For each countertop section, you MUST also return a field "dimensionEvidence": the EXACT dimension text strings you read from the drawing (e.g. ["129\\"", "25 1/4\\""]). If this list is empty, the section will be discarded.

UNIT TYPE NAME (REQUIRED):
- Find the unit/type label printed on THIS page (usually in the title block or near "TYPE ___"). Real examples on shop drawings: "TYPE 2.1C", "TYPE 1.1B-AS", "1BR-A", "STUDIO", "2BR-ADA".
- Copy it VERBATIM — do not shorten, do not invent. If you cannot read it on this page, return "".
- FORBIDDEN: never return "TYPE A", "TYPE B", "Perimeter", or any value from this prompt's examples unless that exact text is actually printed on the image.

For each countertop section return:
- label (short descriptive name based on the drawing — e.g. "Top Run", "Return", "Vanity", "Bar")
- roomName (e.g. "KITCHEN", "MASTER BATH", "POWDER") — "" if you cannot tell
- length (inches, decimal — read from the drawing)
- depth (inches, decimal — read from the drawing; do NOT assume 25.5)
- backsplashLength (inches against the wall; 0 for islands/peninsulas)
- isIsland (true/false)
- category ("kitchen" or "bath") — depth <=22 OR vanity/bath/lav/powder => "bath", else "kitchen"
- dimensionEvidence (array of dimension strings literally visible on the page that justify length/depth)

Rules:
- Scan the ENTIRE page. Split L-shaped or U-shaped runs into straight segments based on the dimension chains shown.
- For length, deduct depth at one corner of an L; for backsplashLength, do NOT deduct corners.
- Count every vanity separately.
- If the image shows no countertops at all, return {"unitTypeName":"<actual or empty>","countertops":[]}.

Return ONLY valid JSON, no markdown:
{"unitTypeName":"<copy from image or empty>","countertops":[{"label":"<from image>","roomName":"<from image or empty>","length":<from image>,"depth":<from image>,"backsplashLength":<from image>,"isIsland":false,"category":"kitchen","dimensionEvidence":["<exact dimension text from image>"]}]}`;
  }

  return `You are an expert millwork estimator analyzing a 2020 countertop shop drawing.

TASK:
1. First, find the UNIT TYPE NAME from the drawing's title block. This is the architectural unit/plan type shown in the title block area (usually bottom-right or top of the drawing). Examples: "1.1B-AS", "TYPE A", "2BR-ADA", "BREAKROOM", "MAIL ROOM", "COMMUNITY ROOM", "STUDIO", "1BR MIRROR", etc. Extract the EXACT and COMPLETE name as it appears — do NOT abbreviate or modify it. This is critical for grouping countertops by unit type. If no title block or type name is visible, use "".

2. Then extract every countertop section visible. For each section extract:

a. **label** — a short descriptive name based on its location (e.g. "Perimeter Left", "Perimeter Right", "Island", "Peninsula", "Bar Top", "Vanity", "L-Section", "U-Section"). If the drawing has text labels, use those.
b. **length** — total linear length in inches. Read dimension labels first. If no label, estimate from the drawing.
c. **depth** — depth in inches. Read from dimension labels. Standard kitchen countertop depth is 25.5". Vanity/bath tops are typically 22" or 19" deep. Islands are often 36-42".
d. **backsplashLength** — the linear inches of WALL backsplash ONLY. This is CRITICAL — read carefully:
   - For EVERY countertop section that is against a wall, backsplash runs along the FULL wall edge.
   - KEY RULE: If a countertop section is against a wall (not an island), the backsplash length should generally EQUAL or be very close to the countertop LENGTH, because backsplash runs the entire length of the countertop along the wall.
   - For L-shaped or U-shaped runs broken into segments: each segment's backsplash = that segment's FULL length along the wall. Do NOT deduct depth at corners — backsplash is continuous along walls.
   - Look for DOUBLE LINES drawn along the WALL edge — these confirm backsplash presence.
   - Do NOT include sidesplash (short perpendicular returns at exposed ends). Sidesplash is tracked separately.
   - Islands and peninsulas typically have backsplashLength = 0 (no wall behind them).
   - If a section is clearly against a wall but you're unsure about backsplash markings, default backsplashLength to the section's length.
 e. **isIsland** — true if this section is an island or peninsula (not against a wall, typically depth >= 30").
 f. **category** — classify as "kitchen" or "bath". Use these rules:
    - If depth is 22" or less (19", 22", etc.) → "bath"  
    - If the label or room mentions "vanity", "bath", "bathroom", "lav", "powder" → "bath"
    - Everything else → "kitchen"

RULES:
- Look for dimension lines, annotations, and measurements in the drawing
- CRITICAL — L/U-SHAPED RUNS: When you see an outer-perimeter dimension chain like "125 3/4" with sub-segments "56 3/4 + 69" along the TOP, AND another perpendicular chain "108" with sub-segments "54 + 30 + 24" along the SIDE — those are TWO SEPARATE LEGS of one L-shape. You MUST return BOTH legs as separate sections (one with length=125.75 depth=25.5, one with length=108 depth=25.5). NEVER return only the longer leg and drop the other. NEVER sum them into one section.
- MIRROR / FLIPPED L-SHAPES — apply the SAME logic regardless of which side the L opens to. An L-shape drawn with the corner on the upper-LEFT is identical to one drawn with the corner on the upper-RIGHT (a mirror). Both must be split into the same two legs and the corner deduction MUST be applied. Do NOT collapse a mirrored L into a single segment just because the orientation is flipped. Example: a "1BR (ADA) - AS" page with outer 138" (94+44) along the top and 116.75" (68+30+18.75) along the right side, AND its mirror "1BR (ADA) - MIRROR" page with the same dimensions flipped to the left side — BOTH must produce two legs (138 and 116.75 of depth 25.5") with the corner deducted from one leg, giving the SAME final top-inches total. The mirror page must NEVER produce a single 254.75" leg.
- For L-shaped or U-shaped runs, break them into individual straight segments based on dimension chains.
- If a countertop wraps around a corner, create separate sections for each leg.
- IMPORTANT for **length** (Top Inches): When breaking L/U-shaped runs at a corner, deduct the depth (e.g. 25.5") from EXACTLY ONE leg per inside corner to avoid double-counting the corner overlap. This is correct for top surface area. For an L-shape with two legs of depth 25.5", the two reported lengths must sum to (legA_outer + legB_outer − 25.5). Worked example: outer legs 138" and 116.75" at depth 25.5" → return one leg as 138 and the other as 91.25 (= 116.75 − 25.5). The total top-inches must be 229.25, NOT 254.75.
- IMPORTANT for **backsplashLength** (BS Inches): Do NOT deduct any depth for corners. Backsplash runs along the wall continuously — measure the FULL OUTER linear inches along the wall with NO corner deduction. Each wall-adjacent segment's backsplashLength = that segment's FULL OUTER length (BEFORE any corner deduction applied to length). The two values are INDEPENDENT — length may be reduced by 25.5" at a corner, but backsplashLength MUST NOT be reduced. Worked example: outer legs 138" + 116.75" depth 25.5" → length values [138, 91.25] (sum 229.25, corner deducted from one leg), backsplashLength values [138, 116.75] (sum 254.75, NO corner deduction — both walls get their full backsplash including the corner overlap, because backsplash is two separate wall pieces meeting at the corner = 25.5" + 25.5" of vertical material at the corner). NEVER make backsplashLength equal to the corner-deducted length on a leg that had its length reduced.
- CRITICAL — MIXED DEPTHS ON ONE PLAN: A single countertop plan can contain segments with DIFFERENT depths (e.g. a 25.5" perimeter run plus a 36" deep peninsula/island extension). You MUST read the depth dimension for EACH segment independently from the dimension labels printed beside that segment. Do NOT assume all segments share the same depth. Worked example (2BR ADA kitchen): outer perimeter shows 92.25" length at depth 25.5", a vertical leg also at 25.5" depth, AND a separate bottom segment showing length 69.25" with depth 36" labeled directly beside it — that 69.25" segment MUST be returned with depth=36, NOT 25.5. Whenever you see a depth label like 36" or 30" printed next to a specific leg, that leg's depth = that printed value, regardless of what the other legs are. Scan EVERY depth dimension on the page and assign each to its corresponding segment — do not collapse multiple depths into a single uniform depth.
- CRITICAL — SINGLE-PIECE TOPS WITH ONE WALL LINE: For small standalone rectangles (corridor counters, powder rooms, work stations) where one long edge is drawn as a heavier/double line (the wall edge), ALWAYS set backsplashLength = length. Do NOT return backsplashLength=0 just because the page is simple. Only islands or peninsulas with no wall behind them get backsplashLength=0.
- Do NOT include appliance surfaces (range top, sink cutout dimensions) as separate sections — they are part of the countertop run
- If the page has no countertop information, return {"unitTypeName":"","countertops":[]}
- Round all dimensions to nearest 0.5 inch
- Standard depths: perimeter = 25.5", island = 36", bar = 12-18", vanity = 22"
- The unitTypeName field is REQUIRED — always look for it in the title block
- IMPORTANT: Scan the ENTIRE page thoroughly. Do not skip any countertop sections, especially smaller segments or sections in corners of the drawing.

Return ONLY valid JSON — no markdown fences, no explanation:
{"unitTypeName":"<from title block>","countertops":[{"label":"<from drawing>","length":<from drawing>,"depth":<from drawing>,"backsplashLength":<from drawing>,"isIsland":false,"category":"kitchen"}]}`;
}

function buildDialagramRescuePrompt(previousContent: string, printedDims: number[] = []): string {
  const dimsBlock = printedDims.length
    ? `\n\nGROUND-TRUTH DIMENSIONS PRINTED ON THIS IMAGE: ${printedDims.map(formatDimensionForPrompt).join(", ")}\nEvery returned length / depth / backsplashLength MUST come from this list. Do NOT invent values.\n`
    : "";
  const previous = previousContent.trim()
    ? previousContent.trim().slice(0, 400)
    : '{"unitTypeName":"","countertops":[]}';

  return `Re-check the SAME countertop shop drawing. Previous pass returned: ${previous}${dimsBlock}

READ DIMENSIONS LITERALLY FROM THE IMAGE. Do not invent values. Numbers in this drawing look like 76 1/2", 25 1/4", 39 3/4", etc. Convert fractions to decimals.

Find every countertop section. For each return: label, roomName (or ""), length, depth, backsplashLength, isIsland, category, and dimensionEvidence (array of dimension strings actually visible on the page).

Also read unitTypeName from the title block VERBATIM (e.g. "TYPE 2.1C"); return "" if not visible. Never default to "TYPE A".

Return ONLY valid JSON, no markdown.`;
}

function buildDialagramCategoryPrompt(category: "kitchen" | "bath", printedDims: number[] = []): string {
  const dimsBlock = printedDims.length
    ? `\n\nGROUND-TRUTH DIMENSIONS PRINTED ON THIS IMAGE: ${printedDims.map(formatDimensionForPrompt).join(", ")}\nEvery returned length / depth / backsplashLength MUST come from this list. Do NOT invent values.\n`
    : "";
  if (category === "bath") {
    return `Look at this countertop shop drawing. Find every BATH / VANITY top.${dimsBlock}

Bath/vanity tops are 19"-22" deep, in MASTER BATH, BATH 2, POWDER, WC, etc.

READ DIMENSIONS LITERALLY from the image — never guess. If a dimension isn't printed, return null.

For each one return: label ("Vanity"), roomName, length, depth, backsplashLength (= length for wall vanities), isIsland (false), category ("bath"), dimensionEvidence (array of dimension strings from the image).

Also return unitTypeName from the title block VERBATIM, or "" if not visible. Never default to "TYPE A".

Return ONLY valid JSON, no markdown.`;
  }

  return `Look at this countertop shop drawing. Find every KITCHEN / ISLAND / BAR / LAUNDRY top.${dimsBlock}

Kitchen perimeter is ~25"-26" deep against a wall. Islands/peninsulas are 30"+ deep, free-standing. Bar tops are 12"-18" deep.

READ DIMENSIONS LITERALLY from the image — never guess. If a dimension isn't printed, return null.

For each section return: label, roomName, length, depth, backsplashLength (= length for wall runs, 0 for islands), isIsland, category ("kitchen"), dimensionEvidence (array of dimension strings from the image).

Split L/U-shaped runs into straight segments using the dimension chains shown.

Also return unitTypeName from the title block VERBATIM, or "" if not visible. Never default to "TYPE A".

Return ONLY valid JSON, no markdown.`;
}

function buildDialagramTitleBlockPrompt(): string {
  return `Find the unit / plan type name printed on this shop drawing page.

Look in the title block (usually bottom-right corner) or sheet header. Real examples that appear on shop drawings: "TYPE 2.1C", "TYPE 1.1B-AS", "1BR-A", "2BR-ADA", "STUDIO", "PENTHOUSE A".

Copy the text EXACTLY as printed on this page. Do NOT default to "TYPE A". If you cannot find a clear unit/plan type name on this page, return "".

Return ONLY valid JSON:
{"unitTypeName":"<exact text or empty>"}`;
}

function buildDialagramFinalizePrompt(unitTypeName: string, countertops: NormalizedCountertop[]): string {
  return `You are finalizing countertop extraction for the attached ONE 2020 shop drawing image.

Candidate JSON:
${JSON.stringify({ unitTypeName, countertops })}

Check the image and return the CORRECT complete JSON.

Rules:
- Keep kitchen sections and bath/vanity sections separate.
- Small vanity tops matter; count each vanity separately.
- Do not merge separate rooms just because dimensions match.
- Preserve roomName and instanceKey for each physical top.
- Add missing sections, remove duplicates, and correct dimensions/categories.
- Split L-shaped or U-shaped tops into straight segments.
- unitTypeName: confirm it matches THIS page's title block VERBATIM. Never default to "TYPE A". If no title block visible on this page, return "".

Return ONLY valid JSON.`;
}

function getDialagramFallbackModels(requestedModel: string): string[] {
  const normalized = String(requestedModel || "qwen-3.6-plus").trim() || "qwen-3.6-plus";
  return normalized === "qwen-3.6-plus"
    ? [normalized, "qwen-3.6-plus-thinking"]
    : [normalized];
}

function getDialagramAccuracyModel(requestedModel: string): string {
  const models = getDialagramFallbackModels(requestedModel);
  return models.includes("qwen-3.6-plus-thinking")
    ? "qwen-3.6-plus-thinking"
    : models[0];
}

// Returns the FAST (non-thinking) model when available — used for first-attempt speed.
function getDialagramFastModel(requestedModel: string): string {
  const normalized = String(requestedModel || "qwen-3.6-plus").trim() || "qwen-3.6-plus";
  return normalized === "qwen-3.6-plus-thinking" ? "qwen-3.6-plus-thinking" : "qwen-3.6-plus";
}

function parseCountertopJSON(content: string): { unitTypeName: string; countertops: any[] } {
  let parsed: { unitTypeName?: string; countertops?: any[] } = { countertops: [] };
  try {
    let cleaned = content.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
    const jsonStart = cleaned.indexOf('{"unitTypeName"');
    if (jsonStart >= 0) {
      cleaned = cleaned.slice(jsonStart);
    } else {
      const altStart = cleaned.indexOf('{"countertops"');
      if (altStart > 0) cleaned = cleaned.slice(altStart);
    }
    const end = cleaned.lastIndexOf("}");
    if (end >= 0) cleaned = cleaned.slice(0, end + 1);
    parsed = JSON.parse(cleaned);
  } catch {
    console.error("JSON parse failed, raw:", content.slice(0, 500));
  }
  return {
    unitTypeName: String(parsed.unitTypeName || "").trim(),
    countertops: parsed.countertops ?? [],
  };
}

function normalizeText(v: unknown): string {
  return String(v || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function numOrNull(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? Math.round(n * 2) / 2 : null;
}

function normalizeCountertop(ct: any) {
  const depth = numOrNull(ct.depth);
  const length = numOrNull(ct.length);
  const backsplashLength = numOrNull(ct.backsplashLength);
  let category = String(ct.category || "").toLowerCase().trim();
  const label = String(ct.label || "Section").trim();
  const roomName = String(ct.roomName || "").trim();
  const instanceKey = String(ct.instanceKey || "").trim();

  if (!category || (category !== "kitchen" && category !== "bath")) {
    const hint = `${label} ${roomName}`.toLowerCase();
    if ((depth != null && depth <= 22) || /vanity|bath|lav|powder|wc/.test(hint)) {
      category = "bath";
    } else {
      category = "kitchen";
    }
  }

  return {
    label,
    roomName: roomName || undefined,
    instanceKey: instanceKey || undefined,
    length,
    depth,
    backsplashLength,
    isIsland: Boolean(ct.isIsland),
    category,
  };
}

function parseAndNormalizeCountertops(content: string) {
  const parsed = parseCountertopJSON(content);
  return {
    parsed,
    countertops: (parsed.countertops ?? []).map(normalizeCountertop),
  };
}

function parseCountertopPassResult(content: string): CountertopPassResult {
  const { parsed, countertops } = parseAndNormalizeCountertops(content);
  return {
    unitTypeName: parsed.unitTypeName,
    countertops,
    raw: content,
  };
}

function normalizeCountertopLabelKey(label: string): string {
  return String(label || "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function isGenericCountertopLabel(label: string): boolean {
  const key = normalizeCountertopLabelKey(label);
  return !key || /^(section|counter|countertop|run|wall run|perimeter|kitchen|bath|vanity|island|peninsula|bar top|top)$/.test(key);
}

function scoreCountertopCandidate(ct: NormalizedCountertop): number {
  let score = 0;
  if (!isGenericCountertopLabel(ct.label)) score += 4;
  if ((ct.backsplashLength ?? 0) > 0 || ct.isIsland) score += 2;
  if (ct.roomName) score += 2;
  if (ct.instanceKey) score += 2;
  if (ct.category === "bath" && ct.depth != null && ct.depth <= 22) score += 2;
  if (ct.category === "kitchen" && ct.depth != null && ct.depth >= 24) score += 2;
  if (ct.length != null && ct.length > 0) score += 1;
  return score;
}

function chooseBetterCountertop(existing: NormalizedCountertop, incoming: NormalizedCountertop): NormalizedCountertop {
  const winner = scoreCountertopCandidate(incoming) > scoreCountertopCandidate(existing)
    ? incoming
    : existing;
  const loser = winner === incoming ? existing : incoming;

  return {
    ...winner,
    roomName: winner.roomName || loser.roomName,
    instanceKey: winner.instanceKey || loser.instanceKey,
    length: winner.length ?? loser.length,
    depth: winner.depth ?? loser.depth,
    backsplashLength: winner.backsplashLength ?? loser.backsplashLength,
  };
}

function areCountertopsLikelySame(a: NormalizedCountertop, b: NormalizedCountertop): boolean {
  if (a.category !== b.category || a.isIsland !== b.isIsland) return false;

  const aRoom = normalizeText(a.roomName);
  const bRoom = normalizeText(b.roomName);
  const aInstance = normalizeText(a.instanceKey);
  const bInstance = normalizeText(b.instanceKey);

  if (aInstance && bInstance) return aInstance === bInstance;

  const lengthClose =
    a.length != null && b.length != null && Math.abs(a.length - b.length) <= 2;
  const depthClose =
    a.depth != null && b.depth != null && Math.abs(a.depth - b.depth) <= 1.5;
  const backsplashClose =
    a.backsplashLength != null &&
    b.backsplashLength != null &&
    Math.abs(a.backsplashLength - b.backsplashLength) <= 4;

  if (a.category === "bath") {
    if (!aRoom || !bRoom) return false;
    return aRoom === bRoom && lengthClose && depthClose && backsplashClose;
  }

  const aLabel = normalizeText(a.label);
  const bLabel = normalizeText(b.label);

  if (aRoom && bRoom && aRoom === bRoom && lengthClose && depthClose && backsplashClose) {
    return true;
  }

  if (aLabel && bLabel && aLabel === bLabel && lengthClose && depthClose && backsplashClose) {
    return true;
  }

  return false;
}

function mergeCountertopCandidateLists(lists: NormalizedCountertop[][]): NormalizedCountertop[] {
  const nonEmptyLists = lists.filter((list) => list.length > 0);
  if (!nonEmptyLists.length) return [];

  const orderedLists = [...nonEmptyLists].sort((a, b) => b.length - a.length);
  const merged = [...orderedLists[0]];

  for (const list of orderedLists.slice(1)) {
    const usedExisting = new Set<number>();
    for (const candidate of list) {
      let matchIndex = -1;
      for (let i = 0; i < merged.length; i++) {
        if (usedExisting.has(i)) continue;
        if (areCountertopsLikelySame(merged[i], candidate)) {
          matchIndex = i;
          break;
        }
      }

      if (matchIndex === -1) {
        merged.push(candidate);
      } else {
        usedExisting.add(matchIndex);
        merged[matchIndex] = chooseBetterCountertop(merged[matchIndex], candidate);
      }
    }
  }

  return merged;
}

function hasNullCriticalDimensions(ct: NormalizedCountertop): boolean {
  return ct.length == null || ct.depth == null || ct.backsplashLength == null;
}

function applyFinalCountertopFallbacks(ct: NormalizedCountertop): NormalizedCountertop {
  const isBath = ct.category === "bath";
  return {
    ...ct,
    length: ct.length ?? (isBath ? 36 : 96),
    depth: ct.depth ?? (isBath ? 22 : (ct.isIsland ? 36 : 25.5)),
    backsplashLength: ct.backsplashLength ?? (ct.isIsland ? 0 : (ct.length ?? (isBath ? 36 : 96))),
  };
}

function scoreUnitTypeName(value: string): number {
  const name = String(value || "").trim();
  if (!name) return -999;

  let score = Math.min(name.length, 24);
  if (/^unknown$/i.test(name)) score -= 100;
  if (/counter\s*top\s*plan|countertop\s*plan|top\s*plan/i.test(name)) score -= 30;
  if (/\btype\b/i.test(name)) score += 14;
  if (/\b\d+\s*br\b/i.test(name)) score += 12;
  if (/\bstudio\b/i.test(name)) score += 12;
  if (/[a-z]*\d+[a-z-]*/i.test(name)) score += 5;
  if (/-/.test(name)) score += 3;
  return score;
}

function sanitizeUnitTypeName(value: string): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^<.*>$/.test(raw)) return "";
  if (/EXACT_TITLE_BLOCK_TEXT/i.test(raw)) return "";
  if (/^(unknown|n\/?a|none|null|empty|tbd|untitled)$/i.test(raw)) return "";
  return raw.replace(/^["']+|["']+$/g, "").trim();
}

function extractUnitTypeFromHintText(text: string): string {
  const cleaned = String(text || "").replace(/\s+/g, " ").trim();
  if (!cleaned) return "";

  const patterns = [
    // Cyncly 2020 footer pattern: "<NAME> Countertops Drawing #"
    /([a-z0-9][a-z0-9().\/\s-]{1,60}?)\s+countertops\s+drawing\s*#/i,
    /(corridor|powder\s*room|unisex\s*bath|half\s*bath|bath(?:room)?|kitchen|work\s*station|workstation|community(?:\s*(?:room|building))?|lobby|laundry|stair)\s+(?:community\s*building|countertops\s+drawing\s*#)/i,
    /(?:parcel\s+[a-z0-9]+(?:\s+[a-z0-9]+)*\s+)?type\s*-?\s*([a-z0-9().\/-]+(?:\s+[a-z0-9().\/-]+){0,4})\s+unit#/i,
    /countertops\s+type\s*-?\s*([a-z0-9().\/-]+(?:\s+[a-z0-9().\/-]+){0,4})\s+(?:parcel|unit#)/i,
    /(?:^|[\s-])((?:\d+br|studio|efficiency|penthouse)[a-z0-9().\/\s-]{0,40}?)\s+unit#/i,
    /countertops\s+([a-z][a-z0-9().\/-]*(?:\s+[a-z0-9().\/-]+){0,4})\s+(?:\d+(?:\s+\d+\s+\d+)?\s*"|parcel\s+[a-z0-9]+|type\s+-?)/i,
  ];

  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    if (!match) continue;
    let candidate = sanitizeUnitTypeName(match[1]);
    candidate = candidate.replace(/^(?:judd\s+homestead\s*-?\s*ct\s*-?\s*)/i, '').trim();
    candidate = candidate.replace(/^(?:judd\s+homestead\s*-?\s*)/i, '').trim();
    candidate = candidate.replace(/\s*(?:no\s+scale|drawing\s*#?.*)$/i, '').trim();
    if (candidate && candidate.length >= 2 && candidate.length <= 60) return candidate;
  }

  return "";
}

function chooseBestUnitTypeName(values: string[]): string {
  const unique = values
    .map(sanitizeUnitTypeName)
    .filter(Boolean)
    .filter((value, index, arr) => arr.indexOf(value) === index);

  if (!unique.length) return "";
  return unique.sort((a, b) => scoreUnitTypeName(b) - scoreUnitTypeName(a))[0];
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const {
      pageImage,
      pageImageMimeType,
      provider: providerInput,
      dialagramModel: dialagramModelInput,
      pageTextHint,
      unitTypeNameHint,
      extractionType: extractionTypeInput,
    } = await req.json();
    const provider: "gemini" | "dialagram" = providerInput === "dialagram" ? "dialagram" : "gemini";
    const dialagramModel = String(dialagramModelInput || "qwen-3.6-plus");
    const extractionType = String(extractionTypeInput || "stone").toLowerCase();
    const imageMimeType = String(pageImageMimeType || "image/jpeg").trim() || "image/jpeg";
    const hintedUnitTypeName = sanitizeUnitTypeName(String(unitTypeNameHint || "")) || extractUnitTypeFromHintText(String(pageTextHint || ""));
    let activeDialagramModel = dialagramModel;
    // Stone SQFT uses gemini-3-flash-preview as primary for accuracy
    const ACTIVE_PRIMARY_MODELS: ModelAttempt[] = extractionType === "stone"
      ? [{ name: "gemini-3-flash-preview", retries: 3 }, { name: "gemini-3.1-flash-lite-preview", retries: 2 }]
      : PRIMARY_MODELS;
    console.log(`extract-pdf-countertops provider=${provider} extractionType=${extractionType} primary=${ACTIVE_PRIMARY_MODELS[0].name}${provider === "dialagram" ? ` model=${dialagramModel}` : ""} mime=${imageMimeType}`);

    if (!pageImage || typeof pageImage !== "string") {
      return new Response(JSON.stringify({ error: "pageImage (base64 string) required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const printedDims = provider === "dialagram" ? extractPrintedDimensionsFromPageText(String(pageTextHint || "")) : [];
    if (printedDims.length) {
      console.log(`Printed dimensions from PDF text (${printedDims.length}):`, printedDims.join(", "));
    }
    const extractionPrompt = buildCountertopExtractionPrompt(provider, printedDims);

    let extractionContent = "";
    let extracted: { unitTypeName: string; countertops: any[] } = { unitTypeName: "", countertops: [] };
    let countertops: NormalizedCountertop[] = [];
    const dialagramPassResults: CountertopPassResult[] = [];
    let dialagramTitleBlockName = hintedUnitTypeName;

    // ── Dedicated title-block pass (Qwen only) ──
    // Runs FIRST so we have an authoritative unit type name before extraction passes
    // can hallucinate "TYPE A" from the prompt example.
    // SKIP if we already have a hint from the client (PDF text layer) — saves ~25s.
    if (provider === "dialagram" && !dialagramTitleBlockName && !hintedUnitTypeName) {
      try {
        const titleBlockContent = await callAI("dialagram", pageImage, imageMimeType, buildDialagramTitleBlockPrompt(), {
          temperature: 0.0,
          maxOutputTokens: 256,
          geminiModels: ACTIVE_PRIMARY_MODELS,
          dialagramModel: getDialagramAccuracyModel(dialagramModel),
        });
        console.log("Dialagram title-block raw:", titleBlockContent.slice(0, 300));
        const tb = parseCountertopJSON(titleBlockContent);
        dialagramTitleBlockName = sanitizeUnitTypeName(tb.unitTypeName);
        console.log("Dialagram title-block detected:", dialagramTitleBlockName || "(none)");
      } catch (tbErr) {
        const knownErrorResponse = buildKnownAIErrorResponse(tbErr);
        if (knownErrorResponse) return knownErrorResponse;
        console.warn("Dialagram title-block pass failed:", tbErr);
      }
    }

    // For Dialagram broad pass, try the FAST (non-thinking) model first to save ~15-25s.
    // Fall back to the thinking model only if fast returns empty/weak results.
    if (provider === "dialagram") {
      activeDialagramModel = getDialagramFastModel(dialagramModel);
    }
    try {
      extractionContent = await callAI(provider, pageImage, imageMimeType, extractionPrompt, {
        temperature: provider === "dialagram" ? 0.0 : 0.2,
        maxOutputTokens: 8192,
        geminiModels: ACTIVE_PRIMARY_MODELS,
        dialagramModel: activeDialagramModel,
      });
    } catch (err) {
      const knownErrorResponse = buildKnownAIErrorResponse(err);
      if (knownErrorResponse) return knownErrorResponse;
      throw err;
    }

    console.log("AI countertop raw:", extractionContent.slice(0, 800));
    ({ parsed: extracted, countertops } = parseAndNormalizeCountertops(extractionContent));
    dialagramPassResults.push({ unitTypeName: extracted.unitTypeName, countertops, raw: extractionContent });

    // If the FAST model returned nothing, retry once with the thinking model before giving up.
    if (provider === "dialagram" && countertops.length === 0) {
      const thinkingModel = getDialagramAccuracyModel(dialagramModel);
      if (thinkingModel !== activeDialagramModel) {
        console.log("Fast Qwen returned empty — retrying with thinking model...");
        try {
          const retryContent = await callAI("dialagram", pageImage, imageMimeType, extractionPrompt, {
            temperature: 0.0,
            maxOutputTokens: 8192,
            geminiModels: ACTIVE_PRIMARY_MODELS,
            dialagramModel: thinkingModel,
          });
          console.log("AI countertop thinking-retry raw:", retryContent.slice(0, 800));
          const retryParsed = parseAndNormalizeCountertops(retryContent);
          if (retryParsed.countertops.length > 0) {
            extractionContent = retryContent;
            extracted = retryParsed.parsed;
            countertops = retryParsed.countertops;
            dialagramPassResults.push({ unitTypeName: extracted.unitTypeName, countertops, raw: retryContent });
            activeDialagramModel = thinkingModel;
          }
        } catch (retryErr) {
          const knownErrorResponse = buildKnownAIErrorResponse(retryErr);
          if (knownErrorResponse) return knownErrorResponse;
          console.warn("Thinking-retry failed:", retryErr);
        }
      }
    }

    if (provider === "dialagram") {
      const focusedModel = getDialagramAccuracyModel(dialagramModel);
      activeDialagramModel = focusedModel;

      // Decide if broad extraction is "good enough" — skip focused passes to save 50s+.
      const broadHasKitchen = countertops.some((ct) => ct.category === "kitchen");
      const broadHasBath = countertops.some((ct) => ct.category === "bath");
      const broadIsHealthy =
        countertops.length >= 2 &&
        !countertops.some(hasNullCriticalDimensions) &&
        !countertops.every((ct) => isGenericCountertopLabel(ct.label));

      // Only run focused passes if broad result is weak — and only the missing category.
      if (!broadIsHealthy) {
        const focusedPasses: Array<{ label: string; prompt: string; model: string }> = [];
        if (!broadHasKitchen) focusedPasses.push({ label: "kitchen-focus", prompt: buildDialagramCategoryPrompt("kitchen", printedDims), model: focusedModel });
        if (!broadHasBath) focusedPasses.push({ label: "bath-focus", prompt: buildDialagramCategoryPrompt("bath", printedDims), model: focusedModel });

        // Run kitchen + bath focused passes IN PARALLEL — saves ~25s when both are needed.
        const passResults = await Promise.all(focusedPasses.map(async (pass) => {
          try {
            const passContent = await callAI("dialagram", pageImage, imageMimeType, pass.prompt, {
              temperature: 0.05,
              maxOutputTokens: 8192,
              geminiModels: ACTIVE_PRIMARY_MODELS,
              dialagramModel: pass.model,
            });
            console.log(`Dialagram ${pass.label} raw (${pass.model}):`, passContent.slice(0, 800));
            return { pass, result: parseCountertopPassResult(passContent), error: null as unknown };
          } catch (focusErr) {
            return { pass, result: null, error: focusErr };
          }
        }));

        for (const { pass, result, error } of passResults) {
          if (error) {
            const knownErrorResponse = buildKnownAIErrorResponse(error);
            if (knownErrorResponse) return knownErrorResponse;
            console.warn(`Dialagram ${pass.label} failed:`, error);
            continue;
          }
          if (result && (result.countertops.length > 0 || result.unitTypeName)) {
            dialagramPassResults.push(result);
          }
        }

        countertops = mergeCountertopCandidateLists(dialagramPassResults.map((result) => result.countertops));
        extracted.unitTypeName = dialagramTitleBlockName
          || chooseBestUnitTypeName(dialagramPassResults.map((result) => result.unitTypeName));
      }

      const shouldRescue =
        countertops.length === 0 ||
        countertops.some(hasNullCriticalDimensions);

      if (shouldRescue) {
        console.log("Dialagram extraction looks incomplete, running single rescue pass...");
        const rescuePrompt = buildDialagramRescuePrompt(extractionContent, printedDims);
        // Only ONE rescue attempt to stay under 150s timeout.
        const rescueModel = getDialagramFallbackModels(focusedModel)[0];
        if (rescueModel) {
          try {
            const rescueContent = await callAI("dialagram", pageImage, imageMimeType, rescuePrompt, {
              temperature: 0.05,
              maxOutputTokens: 8192,
              geminiModels: ACTIVE_PRIMARY_MODELS,
              dialagramModel: rescueModel,
            });
            console.log(`Dialagram rescue raw (${rescueModel}):`, rescueContent.slice(0, 800));

            const rescueResult = parseCountertopPassResult(rescueContent);
            if (rescueResult.countertops.length > 0 || rescueResult.unitTypeName) {
              dialagramPassResults.push(rescueResult);
              countertops = mergeCountertopCandidateLists(dialagramPassResults.map((result) => result.countertops));
              extracted.unitTypeName = dialagramTitleBlockName
                || chooseBestUnitTypeName(dialagramPassResults.map((result) => result.unitTypeName));
            }
            activeDialagramModel = rescueModel;
          } catch (rescueErr) {
            const knownErrorResponse = buildKnownAIErrorResponse(rescueErr);
            if (knownErrorResponse) return knownErrorResponse;
            console.warn(`Dialagram rescue failed for ${rescueModel}:`, rescueErr);
          }
        }
      }
    }

    // ── Hallucination filter: drop Qwen rows whose dimensions don't match printed dims ──
    if (provider === "dialagram" && printedDims.length && countertops.length) {
      const before = countertops.length;
      countertops = countertops.filter((ct) => {
        const lengthOk = isDimensionPrinted(ct.length, printedDims);
        const depthOk = isDimensionPrinted(ct.depth, printedDims);
        if (!lengthOk || !depthOk) {
          console.warn(`Dropping hallucinated row: label="${ct.label}" length=${ct.length} depth=${ct.depth} (not in printed dims)`);
          return false;
        }
        return true;
      });
      if (countertops.length !== before) {
        console.log(`Hallucination filter: ${before} -> ${countertops.length} rows`);
      }
    }

    // Skip verification for Dialagram when results look healthy — saves ~25s and avoids 504s.
    const skipVerification = provider === "dialagram"
      && countertops.length >= 2
      && !countertops.some(hasNullCriticalDimensions);

    if (countertops.length > 0 && !skipVerification) {
      console.log("Starting verification pass...");
      const verifyPrompt = provider === "dialagram"
        ? buildDialagramFinalizePrompt(extracted.unitTypeName, countertops)
        : `You are verifying AI-extracted countertop data from a 2020 shop drawing.

Here is the extracted data:
${JSON.stringify({ unitTypeName: extracted.unitTypeName, countertops }, null, 2)}

Look at the SAME shop drawing image and verify:
1. Is the unitTypeName correct? If not, provide the correct one.
2. Are there any MISSING countertop sections that were not extracted? Add them.
3. Are the dimensions (length, depth, backsplashLength) accurate? Correct any errors. CRITICAL: backsplashLength must use the FULL OUTER wall length WITHOUT any corner deduction, even when length was reduced by depth (e.g. 25.5") at a corner. For an L-shape with outer legs 138" and 116.75" at depth 25.5", lengths are [138, 91.25] but backsplashLength must be [138, 116.75]. Backsplash and Top Inches are INDEPENDENT — never make backsplashLength match a corner-deducted length.
4. Are the categories (kitchen/bath) correct?
5. Are there any DUPLICATE sections that should be removed?
6. Are any sections actually NOT countertops (e.g. appliance cutouts listed separately)?

Return the CORRECTED complete JSON — same format:
{"unitTypeName":"...","countertops":[...]}

If everything looks correct, return the data as-is. Return ONLY valid JSON — no markdown fences, no explanation.`;

      try {
        const verifyContent = await callAI(provider, pageImage, imageMimeType, verifyPrompt, {
          temperature: provider === "dialagram" ? 0.05 : 0.1,
          maxOutputTokens: 8192,
          geminiModels: VERIFY_MODELS,
          dialagramModel: provider === "dialagram" ? getDialagramAccuracyModel(activeDialagramModel) : activeDialagramModel,
        });
        console.log("Verify countertop raw:", verifyContent.slice(0, 800));
        const verified = parseAndNormalizeCountertops(verifyContent);

        if (verified.countertops.length > 0) {
          const verifiedCts = verified.countertops.map(applyFinalCountertopFallbacks);
          const unitTypeName = provider === "dialagram"
            ? (hintedUnitTypeName || dialagramTitleBlockName || chooseBestUnitTypeName([verified.parsed.unitTypeName, extracted.unitTypeName]))
            : (hintedUnitTypeName || verified.parsed.unitTypeName || extracted.unitTypeName || "").trim();
          console.log("Verified unit type:", unitTypeName, "sections:", verifiedCts.length);

          return new Response(JSON.stringify({ unitTypeName, countertops: verifiedCts }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      } catch (verifyErr) {
        console.warn("Verification pass failed, using extraction result:", verifyErr);
      }
    }

    const unitTypeName = provider === "dialagram"
      ? (hintedUnitTypeName || dialagramTitleBlockName || chooseBestUnitTypeName([extracted.unitTypeName]))
      : (hintedUnitTypeName || extracted.unitTypeName);
    console.log("Detected unit type name:", unitTypeName);
    const finalizedCountertops = countertops.map(applyFinalCountertopFallbacks);

    return new Response(JSON.stringify({ unitTypeName, countertops: finalizedCountertops }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("extract-pdf-countertops error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
