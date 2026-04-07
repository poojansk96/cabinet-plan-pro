import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type ModelAttempt = { name: string; retries: number };

const PRIMARY_MODELS: ModelAttempt[] = [
  { name: "gemini-3-flash", retries: 3 },
  { name: "gemini-2.5-pro", retries: 2 },
];

const VERIFY_MODELS: ModelAttempt[] = [
  { name: "gemini-3-flash", retries: 2 },
  { name: "gemini-2.5-pro", retries: 1 },
];

const COMMON_AREA_LABELS: Array<{ label: string; re: RegExp }> = [
  { label: "Kitchenette", re: /\bKITCHENETTE\b/i },
  { label: "Mail Room", re: /\bMAIL\s*ROOM\b/i },
  { label: "Break Room", re: /\bBREAK\s*ROOM\b/i },
  { label: "Business Center", re: /\bBUSINESS\s*CENTER\b/i },
  { label: "Community Room", re: /\bCOMMUNITY\s*ROOM\b/i },
  { label: "Pool Bath", re: /\bPOOL\s*BATH\b/i },
  { label: "Leasing", re: /\bLEASING\b/i },
  { label: "Clubhouse", re: /\bCLUBHOUSE\b/i },
  { label: "Fitness", re: /\bFITNESS\b/i },
  { label: "Laundry", re: /\bLAUNDRY\b/i },
  { label: "Restroom", re: /\bRESTROOM\b/i },
  { label: "Lobby", re: /\bLOBBY\b/i },
  { label: "Office", re: /\bOFFICE\b/i },
  { label: "Reception", re: /\bRECEPTION\b/i },
  { label: "Storage", re: /\bSTORAGE\b/i },
  { label: "Garage", re: /\bGARAGE\b/i },
  { label: "Corridor", re: /\bCORRIDOR\b/i },
  { label: "Mechanical", re: /\bMECHANICAL\b/i },
  { label: "Maintenance", re: /\bMAINTENANCE\b/i },
  { label: "Trash", re: /\bTRASH\b/i },
];

function normalizeTypeText(value: string): string {
  return String(value || "")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s*-\s*/g, "-")
    .replace(/\s*\(\s*/g, " (")
    .replace(/\s*\)\s*/g, ")")
    .trim();
}

function detectCommonAreaLabel(value: string): string | null {
  for (const entry of COMMON_AREA_LABELS) {
    if (entry.re.test(value)) return entry.label;
  }
  return null;
}

function normalizeResolvedTypeLabel(value: string): string {
  const clean = normalizeTypeText(value);
  if (!clean) return "";
  if (/^(?:PLAN|ELEVATION|SECTION|DETAIL|SHEET|DRAWING|LEGEND)\b/i.test(clean)) return "";
  const commonArea = detectCommonAreaLabel(clean);
  if (commonArea) return commonArea;
  return clean.toUpperCase();
}

function hasStrongTypeStructure(value: string): boolean {
  const text = normalizeResolvedTypeLabel(value).toUpperCase();
  if (!text) return false;
  return /\bTYPE\b/.test(text)
    || /\b(?:STUDIO|\d+BR)\b/.test(text)
    || /(?:^|[-\s])(?:AS|MIRROR|ADA|REV|ALT|OPTION)\b/.test(text)
    || Boolean(detectCommonAreaLabel(text));
}

function isSuspiciousTypeLabel(value: string): boolean {
  const text = normalizeResolvedTypeLabel(value);
  if (!text) return true;
  if (hasStrongTypeStructure(text)) return false;
  if (/^(?:BLDG|BUILDING|FLOOR|LEVEL|UNIT)\b/i.test(text)) return true;
  return /^[A-Z]?\d{1,4}[A-Z]?(?:-\d{1,4}[A-Z]?)?$/.test(text.toUpperCase().replace(/\s+/g, ""));
}

function canonicalTypeBase(value: string): string {
  const text = normalizeResolvedTypeLabel(value).toUpperCase();
  if (!text) return "";
  const commonArea = detectCommonAreaLabel(text);
  if (commonArea) return commonArea.toUpperCase().replace(/\s+/g, "");
  return text
    .replace(/\s+\((AS|MIRROR|ADA|REV|ALT|OPTION)\)$/g, "")
    .replace(/-(AS|MIRROR|ADA|REV|ALT|OPTION)\b/g, "")
    .replace(/^TYPE\s+/, "")
    .replace(/\s+/g, "")
    .trim();
}

function typeSpecificityScore(value: string): number {
  const text = normalizeResolvedTypeLabel(value).toUpperCase();
  if (!text) return 0;
  let score = text.replace(/\s+/g, "").length;
  if (/\bTYPE\b/.test(text)) score += 25;
  if (/\b(?:STUDIO|\d+BR)\b/.test(text)) score += 20;
  if (/(?:^|[-\s])(?:AS|MIRROR|ADA|REV|ALT|OPTION)\b/.test(text)) score += 30;
  if (/\(|\)|\./.test(text)) score += 10;
  if (detectCommonAreaLabel(text)) score += 30;
  return score;
}

function trimPageText(value: string, limit = 12000): string {
  const text = normalizeTypeText(value);
  return text.length > limit ? text.slice(0, limit) : text;
}

function extractTypeFromPageText(pageText: string): string | null {
  const text = trimPageText(pageText).replace(/[|]+/g, " ");
  if (!text) return null;

  const patterns = [
    /\b(?:STUDIO|\d+\s*BR)\s+TYPE\s+[A-Z0-9][A-Z0-9._]*(?:\s*-\s*[A-Z0-9._]+)*(?:\s+\([A-Z0-9 ._-]+\))?/i,
    /\bTYPE\s+[A-Z0-9][A-Z0-9._]*(?:\s*-\s*[A-Z0-9._]+)*(?:\s+\([A-Z0-9 ._-]+\))?/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern)?.[0];
    if (!match) continue;
    const resolved = normalizeResolvedTypeLabel(match);
    if (resolved && !isSuspiciousTypeLabel(resolved)) return resolved;
  }

  return detectCommonAreaLabel(text);
}

function pickPreferredUnitType(aiType: string, pageText: string): string {
  const resolvedAi = normalizeResolvedTypeLabel(aiType);
  const resolvedFromText = extractTypeFromPageText(pageText) || "";
  if (!resolvedAi) return resolvedFromText;
  if (!resolvedFromText) return resolvedAi;
  if (isSuspiciousTypeLabel(resolvedAi)) return resolvedFromText;

  const aiBase = canonicalTypeBase(resolvedAi);
  const textBase = canonicalTypeBase(resolvedFromText);
  if (aiBase && textBase && aiBase === textBase && typeSpecificityScore(resolvedFromText) > typeSpecificityScore(resolvedAi)) {
    return resolvedFromText;
  }

  return resolvedAi;
}

async function requestGemini(
  apiKey: string,
  imageData: string,
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
              contents: [{ role: "user", parts: [
                { inlineData: { mimeType: "image/jpeg", data: imageData } },
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
        console.error(`AI error for ${model}:`, response.status, errText);
        response = null;
        break;
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

function extractBalancedObjectsFromNamedArray(content: string, key: string): string[] {
  const keyIndex = content.indexOf(`"${key}"`);
  if (keyIndex < 0) return [];

  const arrayStart = content.indexOf("[", keyIndex);
  if (arrayStart < 0) return [];

  const objects: string[] = [];
  let depth = 0;
  let objectStart = -1;
  let inString = false;
  let escapeNext = false;

  for (let index = arrayStart + 1; index < content.length; index++) {
    const char = content[index];

    if (escapeNext) {
      escapeNext = false;
      continue;
    }

    if (char === "\\" && inString) {
      escapeNext = true;
      continue;
    }

    if (char === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (char === "{") {
      if (depth === 0) objectStart = index;
      depth += 1;
      continue;
    }

    if (char === "}") {
      if (depth > 0) depth -= 1;
      if (depth === 0 && objectStart >= 0) {
        objects.push(content.slice(objectStart, index + 1));
        objectStart = -1;
      }
      continue;
    }

    if (char === "]" && depth === 0) break;
  }

  return objects;
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
    const cleaned = content.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
    const recoveredType = cleaned.match(/"unitTypeName"\s*:\s*"([^"]*)"/i)?.[1] ?? "";
    const recoveredCountertops = extractBalancedObjectsFromNamedArray(cleaned, "countertops")
      .map((entry) => {
        try {
          return JSON.parse(entry);
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    if (recoveredCountertops.length > 0 || recoveredType) {
      return {
        unitTypeName: String(recoveredType).trim(),
        countertops: recoveredCountertops,
      };
    }

    console.error("JSON parse failed, raw:", content.slice(0, 500));
  }
  return {
    unitTypeName: String(parsed.unitTypeName || "").trim(),
    countertops: parsed.countertops ?? [],
  };
}

function normalizeCountertop(ct: any) {
  const depth = Math.round((Number(ct.depth) || 25.5) * 2) / 2;
  let category = String(ct.category || "").toLowerCase().trim();
  if (!category || (category !== "kitchen" && category !== "bath")) {
    const label = String(ct.label || "").toLowerCase();
    if (depth <= 22 || /vanity|bath|lav|powder/.test(label)) {
      category = "bath";
    } else {
      category = "kitchen";
    }
  }
  return {
    label: String(ct.label || "Section").trim(),
    length: Math.round((Number(ct.length) || 96) * 2) / 2,
    depth,
    backsplashLength: Math.round((Number(ct.backsplashLength) || 0) * 2) / 2,
    isIsland: Boolean(ct.isIsland),
    category,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not configured");

    const { pageImage, pageText = "" } = await req.json();
    const pageTextSnippet = trimPageText(String(pageText || ""));

    if (!pageImage || typeof pageImage !== "string") {
      return new Response(JSON.stringify({ error: "pageImage (base64 string) required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const extractionPrompt = `You are an expert millwork estimator analyzing a 2020 countertop shop drawing.

PDF TEXT LAYER (use this to recover exact type names when the image text is small):
${pageTextSnippet || "(not available)"}

TASK:
1. First, find the UNIT TYPE NAME from the drawing's title block. This is the architectural unit/plan type shown in the title block area (usually bottom-right or top of the drawing). Examples: "1.1B-AS", "TYPE A", "2BR-ADA", "BREAKROOM", "MAIL ROOM", "COMMUNITY ROOM", "STUDIO", "1BR MIRROR", etc. Extract the EXACT and COMPLETE name as it appears — do NOT abbreviate or modify it. This is critical for grouping countertops by unit type. If no title block or type name is visible, use "".
   - CRITICAL: Preserve suffixes like -AS, -MIRROR, -ADA, and trailing digits.
   - CRITICAL: Never use building labels or unit numbers as the unitTypeName.

2. Then extract every countertop section visible. For each section extract:
   - CRITICAL: Return EVERY countertop/top run on the page. Missing a run is worse than returning a duplicate. Include short legs, small vanity tops, and corner segments.

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
- For L-shaped or U-shaped runs, break them into individual straight segments
- If a countertop wraps around a corner, create separate sections for each leg
- IMPORTANT for **length** (Top Inches): When breaking L/U-shaped runs at a corner, deduct the depth (e.g. 25.5") from one leg to avoid double-counting the corner overlap. This is correct for top surface area.
- IMPORTANT for **backsplashLength** (BS Inches): Do NOT deduct any depth for corners. Backsplash runs along the wall continuously — measure the FULL linear inches along the wall with NO corner deduction. Each wall-adjacent segment's backsplash = its full length.
- Do NOT include appliance surfaces (range top, sink cutout dimensions) as separate sections — they are part of the countertop run
- If the page has no countertop information, return {"unitTypeName":"","countertops":[]}
- Round all dimensions to nearest 0.5 inch
- Standard depths: perimeter = 25.5", island = 36", bar = 12-18", vanity = 22"
- The unitTypeName field is REQUIRED — always look for it in the title block
- IMPORTANT: Scan the ENTIRE page thoroughly. Do not skip any countertop sections, especially smaller segments or sections in corners of the drawing.

Return ONLY valid JSON — no markdown fences, no explanation:
{"unitTypeName":"1.1B-AS","countertops":[{"label":"Perimeter Left","length":96,"depth":25.5,"backsplashLength":96,"isIsland":false,"category":"kitchen"}]}`;

    // ── Pass 1: Extraction ──
    let extractionContent = "";
    try {
      extractionContent = await requestGemini(
        GEMINI_API_KEY,
        pageImage,
        extractionPrompt,
        PRIMARY_MODELS,
        { temperature: 0.2, maxOutputTokens: 8192 },
      );
    } catch (err) {
      if (err instanceof Error && err.message === "rate_limit") {
        return new Response(JSON.stringify({ error: "rate_limit" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (err instanceof Error && err.message === "credits") {
        return new Response(JSON.stringify({ error: "credits" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (err instanceof Error && err.message === "ai_unavailable") {
        return new Response(JSON.stringify({ error: "AI model temporarily unavailable.", unitTypeName: "", countertops: [] }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      throw err;
    }

    console.log("AI countertop raw:", extractionContent.slice(0, 800));
    const extracted = parseCountertopJSON(extractionContent);
    const countertops = (extracted.countertops).map(normalizeCountertop);

    // ── Pass 2: Verification ──
    if (countertops.length > 0 || !!pageTextSnippet || !!extracted.unitTypeName) {
      console.log("Starting verification pass...");
      const verifyPrompt = `You are verifying AI-extracted countertop data from a 2020 shop drawing.

Here is the extracted data:
${JSON.stringify({ unitTypeName: extracted.unitTypeName, countertops }, null, 2)}

Look at the SAME shop drawing image and verify:
1. Is the unitTypeName correct? If not, provide the correct one.
2. Are there any MISSING countertop sections that were not extracted? Add them.
2a. If the extracted list is empty or incomplete, do a fresh full extraction from scratch and return the COMPLETE list.
3. Are the dimensions (length, depth, backsplashLength) accurate? Correct any errors.
4. Are the categories (kitchen/bath) correct?
5. Are there any DUPLICATE sections that should be removed?
6. Are any sections actually NOT countertops (e.g. appliance cutouts listed separately)?
7. Re-scan the full page carefully and make sure no countertop run is missed, including short segments, bath tops, and small vanity runs.

Return the CORRECTED complete JSON — same format:
{"unitTypeName":"...","countertops":[...]}

If everything looks correct, return the data as-is. Return ONLY valid JSON — no markdown fences, no explanation.`;

      try {
        const verifyContent = await requestGemini(
          GEMINI_API_KEY,
          pageImage,
          verifyPrompt,
          VERIFY_MODELS,
          { temperature: 0.1, maxOutputTokens: 8192 },
        );
        console.log("Verify countertop raw:", verifyContent.slice(0, 800));
        const verified = parseCountertopJSON(verifyContent);

        if (verified.countertops && verified.countertops.length > 0) {
          const verifiedCts = verified.countertops.map(normalizeCountertop);
          const unitTypeName = pickPreferredUnitType(verified.unitTypeName || extracted.unitTypeName || "", pageTextSnippet);
          console.log("Verified unit type:", unitTypeName, "sections:", verifiedCts.length);

          return new Response(JSON.stringify({ unitTypeName, countertops: verifiedCts }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      } catch (verifyErr) {
        console.warn("Verification pass failed, using extraction result:", verifyErr);
      }
    }

    // Fallback: return extraction result
    const unitTypeName = pickPreferredUnitType(extracted.unitTypeName, pageTextSnippet);
    console.log("Detected unit type name:", unitTypeName);

    return new Response(JSON.stringify({ unitTypeName, countertops }), {
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
