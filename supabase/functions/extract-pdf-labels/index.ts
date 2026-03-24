import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── AI Call Helper (supports structured JSON output) ──

async function callGemini(
  apiKey: string,
  model: string,
  pageImage: string,
  prompt: string,
  temperature = 0.1,
  maxTokens = 8192,
  responseSchema?: any,
): Promise<any> {
  // Model fallback: try primary model 3 times, then fallback to gemini-2.5-flash 3 times
  const MODELS = [model, "gemini-2.5-flash"];
  const MAX_RETRIES = 3;
  let response: Response | null = null;

  const genConfig: any = { temperature, maxOutputTokens: maxTokens };
  if (responseSchema) {
    genConfig.responseMimeType = "application/json";
    genConfig.responseSchema = responseSchema;
  }

  for (const currentModel of MODELS) {
    let modelSucceeded = false;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${currentModel}:generateContent?key=${apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ role: "user", parts: [
                { inlineData: { mimeType: "image/jpeg", data: pageImage } },
                { text: prompt },
              ]}],
              generationConfig: genConfig,
            }),
          },
        );
      } catch (fetchErr) {
        console.error(`AI fetch error [${currentModel}] (attempt ${attempt + 1}):`, fetchErr);
        if (attempt < MAX_RETRIES - 1) { await new Promise(r => setTimeout(r, 2000 * (attempt + 1))); continue; }
        break; // Try next model
      }

      if (response.status === 429) {
        console.warn(`AI rate limited (429) [${currentModel}], attempt ${attempt + 1}/${MAX_RETRIES}`);
        response = null;
        if (attempt < MAX_RETRIES - 1) { await new Promise(r => setTimeout(r, 8000 * (attempt + 1))); continue; }
        throw new Error("rate_limit"); // Rate limit affects all models, don't fallback
      }
      if (response.status === 503 || response.status === 500) {
        console.warn(`AI unavailable (${response.status}) [${currentModel}], attempt ${attempt + 1}/${MAX_RETRIES}`);
        response = null;
        if (attempt < MAX_RETRIES - 1) { await new Promise(r => setTimeout(r, 3000 * (attempt + 1))); continue; }
        console.log(`${currentModel} failed after ${MAX_RETRIES} retries, trying fallback...`);
        break; // Try next model
      }
      modelSucceeded = true;
      break;
    }

    if (modelSucceeded && response) break;
  }

  if (!response) throw new Error("AI model temporarily unavailable");
  if (response.status === 402) throw new Error("credits");
  if (!response.ok) {
    const errText = await response.text();
    console.error("AI gateway error:", response.status, errText);
    throw new Error(`AI error: ${response.status}`);
  }

  const aiData = await response.json();
  const text = aiData.candidates?.[0]?.content?.parts?.[0]?.text ?? "";

  // If structured output was requested, parse directly
  if (responseSchema) {
    try { return JSON.parse(text); } catch {
      // Fallback: strip markdown fences
      const cleaned = text.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
      try { return JSON.parse(cleaned); } catch {
        console.warn("Structured output parse failed, attempting truncated JSON recovery...");
        // ── Truncated JSON recovery ──
        // The AI sometimes returns truncated JSON. Try to recover complete item objects.
        const itemRegex = /\{\s*"sku"\s*:\s*"([^"]+)"\s*,\s*"type"\s*:\s*"([^"]+)"\s*,\s*"room"\s*:\s*"([^"]+)"\s*,\s*"quantity"\s*:\s*(\d+)\s*\}/g;
        const recoveredItems: any[] = [];
        let match;
        while ((match = itemRegex.exec(text)) !== null) {
          recoveredItems.push({ sku: match[1], type: match[2], room: match[3], quantity: parseInt(match[4]) });
        }
        if (recoveredItems.length > 0) {
          console.log(`Recovered ${recoveredItems.length} items from truncated response`);
          // Also try to extract unitTypeName if present
          const unitTypeMatch = text.match(/"unitTypeName"\s*:\s*"([^"]+)"/);
          return { items: recoveredItems, unitTypeName: unitTypeMatch ? unitTypeMatch[1] : null };
        }
        console.error("No items recovered from truncated response:", text.slice(0, 300));
        return {};
      }
    }
  }

  return text;
}

// ── SKU Helpers ──

const SKU_PATTERN = /\b(B|DB|SB|CB|EB|LS|LSB|W|WDC|UB|WC|OH|BLW|BRW|T|TF|UT|TC|PT|PTC|UC|V|VB|VD|VDC|FIL|BF|WF|BFFIL|WFFIL|TK|TKRUN|CM|LR|EP|FP|DWR|HA|HAV|HALC|HAL|SA|SV|APPRON|UREP|REP|HCOC|HCUC|HCDB|HCLS|HCBM|HCB|HC|HWSB|HW|HSS|HS)\d[\w\-\/]*(?:\((?:SPLIT)\)|\[(?:SPLIT)\]|_SPLIT)?/gi;
const APPLIANCE_RE = /^(REF|REFRIG|REFRIGERATOR|DW(?!R)|DDW|DISHWASHER|DISHW|RANGE|HOOD|MICRO|OTR|OVEN|COOK|STOVE|MW|WM|WASHER|DRYER|FREEZER|WINE|ICE|TRASH|COMPACT|SINK|FAN|VENT|DISP|CKT)/i;
// Relaxed: accept any 1-8 letter prefix followed by a digit (catches manufacturer-specific SKUs like HAV, HALC)
const SKU_PREFIX_RE = /^[A-Z]{1,8}\d/i;
const NO_DIGIT_OK = /^(BP|SCRIBE|UC)$/i;
const STRONG_STRIP_SKU_RE = /^(?:UC|BP|SCRIBE|APPRON|UREP|REP|[A-Z]{2,8}\d[A-Z0-9\-\/]{2,})$/i;
const SPLIT_SUFFIX_RE = /(?:\((?:SPLIT)\)|\[(?:SPLIT)\]|_SPLIT)$/i;

function normalizeSkuLabel(value: string): string {
  return String(value || '')
    .toUpperCase()
    .trim()
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, '')
    .replace(/-+$/, ''); // Strip trailing hyphens (truncated/hidden labels)
}

function stripSplitSuffix(value: string): string {
  return normalizeSkuLabel(value).replace(SPLIT_SUFFIX_RE, '');
}

function isValidSku(s: string): boolean {
  const upper = s.toUpperCase().trim();
  if (!upper || upper.length < 2) return false;
  if (APPLIANCE_RE.test(upper)) return false;
  if (/^UNIT\b/i.test(upper) || /^ELEV/i.test(upper) || /^FLOOR/i.test(upper) || /^TYPE\s/i.test(upper)) return false;
  if (upper.includes('/') && !(/^(BLW|BRW)\d/i.test(upper))) return false;
  // Reject bare dimension suffixes like "X84", "X96" — these are WxH tails, not real SKUs
  if (/^X\d+$/i.test(upper)) return false;
  return SKU_PREFIX_RE.test(upper);
}

function extractSkusFromText(pageText: string): string[] {
  if (!pageText) return [];
  const matches = pageText.match(SKU_PATTERN) || [];
  const noDigitMatches = pageText.match(/\b(BP|SCRIBE|UC)\b/gi) || [];
  const skus = new Set<string>();

  for (const m of [...matches, ...noDigitMatches]) {
    const upper = normalizeSkuLabel(m);
    if (APPLIANCE_RE.test(upper)) continue;
    if (/^UNIT\b/i.test(upper) || /^ELEV/i.test(upper) || /^FLOOR/i.test(upper) || /^TYPE\s/i.test(upper)) continue;
    if (!isValidSku(upper) && !NO_DIGIT_OK.test(upper)) continue;
    skus.add(upper);
  }

  return [...skus];
}

function countSkusFromText(pageText: string): Record<string, number> {
  const counts: Record<string, number> = {};
  if (!pageText) return counts;

  const matches = pageText.match(SKU_PATTERN) || [];
  const noDigitMatches = pageText.match(/\b(BP|SCRIBE|UC)\b/gi) || [];

  for (const m of [...matches, ...noDigitMatches]) {
    const upper = normalizeSkuLabel(m);
    if (APPLIANCE_RE.test(upper)) continue;
    if (/^UNIT\b/i.test(upper) || /^ELEV/i.test(upper) || /^FLOOR/i.test(upper) || /^TYPE\s/i.test(upper)) continue;
    if (!isValidSku(upper) && !NO_DIGIT_OK.test(upper)) continue;
    counts[upper] = (counts[upper] ?? 0) + 1;
  }

  return counts;
}

function classifySku(sku: string): string {
  if (/^(BLW|BRW)/i.test(sku)) return "Wall";
  if (/^(W|WDC|UB|WC|OH)\d/i.test(sku)) return "Wall";
  // HC/HW/HS manufacturer prefixes: classify by the inner prefix after H
  if (/^HW/i.test(sku)) return "Wall";   // HWSB = H + Wall variant
  if (/^HCW\d/i.test(sku)) return "Wall";
  if (/^(T|UT|TC|PT|PTC|UC)(\d|$)/i.test(sku)) return "Tall";
  if (/^(HALC|HCUC)\d/i.test(sku)) return "Tall";
  if (/^(V|VB|VD|VDC)\d/i.test(sku)) return "Vanity";
  if (/^(HAV)\d/i.test(sku)) return "Vanity";
  if (/^(FIL|BF|WF|BFFIL|WFFIL|TK|TKRUN|CM|LR|EP|FP|DWR|TF|APPRON|UREP|REP)\d/i.test(sku)) return "Accessory";
  return "Base";
}

// Dimension-pattern SKU: prefix + digits + X + digits (e.g., UC15X84, TF3X96, HCUC15X8)
const DIMENSION_SKU_RE = /^[A-Z]{1,8}\d+X\d+/i;

function trySplitConcatenatedSku(rawSku: string, knownTextSkus: string[] = []): string[] | null {
  const sku = normalizeSkuLabel(rawSku);
  if (!sku) return null;

  // Never split dimension-pattern SKUs like UC15X84, TF3X96
  if (DIMENSION_SKU_RE.test(sku)) return null;

  const known = [...new Set(knownTextSkus.map(normalizeSkuLabel).filter(Boolean))]
    .sort((a, b) => b.length - a.length);
  const knownSet = new Set(known);

  if (knownSet.has(sku)) return null;

  const memo = new Map<number, string[] | null>();
  const segmentWithKnown = (start: number): string[] | null => {
    if (start === sku.length) return [];
    if (memo.has(start)) return memo.get(start)!;

    for (const candidate of known) {
      if (!candidate || !sku.startsWith(candidate, start)) continue;
      const rest = segmentWithKnown(start + candidate.length);
      if (rest) {
        const found = [candidate, ...rest];
        memo.set(start, found);
        return found;
      }
    }

    memo.set(start, null);
    return null;
  };

  const exactSegments = segmentWithKnown(0);
  if (exactSegments && exactSegments.length >= 2) return exactSegments;

  // No fallback heuristic splitting — only split when both parts are confirmed
  // in the text layer. This prevents false splits of compound SKUs like HWSB30PSX23H.
  return null;
}

// Split merged/touching SKUs conservatively:
// 1) explicit hyphen boundaries where both sides are valid SKUs
// 2) text-layer-guided concatenations like HCUC15X8HCOC3082D or W1230VDC2430
function splitMergedSkus(items: any[], knownTextSkus: string[] = []): any[] {
  const result: any[] = [];
  for (const item of items) {
    const sku = String(item?.sku ?? '').toUpperCase().trim();
    if (!sku) { result.push(item); continue; }

    let wasSplit = false;
    const hyphenParts = sku.split('-');
    if (hyphenParts.length >= 2) {
      for (let i = 1; i < hyphenParts.length; i++) {
        const left = hyphenParts.slice(0, i).join('-');
        const right = hyphenParts.slice(i).join('-');
        if (isValidSku(left) && isValidSku(right)) {
          console.log(`Split merged SKU: "${sku}" → "${left}" + "${right}"`);
          result.push({ ...item, sku: left, type: classifySku(left), quantity: Number(item.quantity) || 1 });
          result.push({ ...item, sku: right, type: classifySku(right), quantity: Number(item.quantity) || 1 });
          wasSplit = true;
          break;
        }
      }
    }

    if (!wasSplit) {
      const concatenated = trySplitConcatenatedSku(sku, knownTextSkus);
      if (concatenated && concatenated.length >= 2) {
        console.log(`Split touching SKU labels: "${sku}" → ${concatenated.join(' + ')}`);
        for (const part of concatenated) {
          result.push({ ...item, sku: part, type: classifySku(part), quantity: Number(item.quantity) || 1 });
        }
        wasSplit = true;
      }
    }

    if (!wasSplit) result.push(item);
  }
  return result;
}

/**
 * Fix AI-merged adjacent labels using the text layer as ground truth.
 * E.g., AI returns "RW1230" but text layer has "W1230" → use "W1230".
 * The leading chars belonged to a different adjacent cabinet label.
 * Only corrects when the text layer confirms the shorter SKU exists.
 */
function fixMergedAdjacentLabel(sku: string, textLayerSkuSet: Set<string>): string {
  const upper = sku.toUpperCase();
  if (textLayerSkuSet.has(upper)) return upper; // Already exact match

  // Try removing 1-3 leading characters and check if result is in text layer
  for (let strip = 1; strip <= 3 && strip < upper.length - 2; strip++) {
    const candidate = upper.slice(strip);
    if (textLayerSkuSet.has(candidate) && isValidSku(candidate)) {
      console.log(`Fixed merged adjacent label: "${sku}" → "${candidate}" (text layer match)`);
      return candidate;
    }
    // Also check suffix variants (e.g., text has "W1230-L" but AI returned "RW1230-L")
    for (const tlSku of textLayerSkuSet) {
      if (tlSku.startsWith(candidate + '-') || candidate.startsWith(tlSku)) {
        if (isValidSku(candidate)) {
          console.log(`Fixed merged adjacent label: "${sku}" → "${candidate}" (text layer prefix match)`);
          return candidate;
        }
      }
    }
  }

  return upper;
}

// ── Structured Output Schemas (Gemini native JSON mode) ──

const CLASSIFY_SCHEMA = {
  type: "OBJECT",
  properties: {
    pageType: { type: "STRING" },
    unitTypeName: { type: "STRING", nullable: true },
    isCommonArea: { type: "BOOLEAN" },
  },
  required: ["pageType", "isCommonArea"],
};

const EXTRACT_SCHEMA = {
  type: "OBJECT",
  properties: {
    unitTypeName: { type: "STRING", nullable: true },
    items: {
      type: "ARRAY",
      items: {
        type: "OBJECT",
        properties: {
          sku: { type: "STRING" },
          type: { type: "STRING" },
          room: { type: "STRING" },
          quantity: { type: "INTEGER" },
        },
        required: ["sku", "type", "room", "quantity"],
      },
    },
  },
  required: ["items"],
};

// ── Main Handler ──

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not configured");

    const { pageImage, unitType, pageText, speedMode, classificationOverride, isStrip, skipClassify } = await req.json();

    if (!pageImage || typeof pageImage !== "string") {
      return new Response(JSON.stringify({ error: "pageImage (base64 string) required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Extract SKUs from PDF text layer (instant, no AI needed)
    const textLayerSkus = extractSkusFromText(pageText ?? "");
    const textLayerSkuSet = new Set(textLayerSkus.map((s) => normalizeSkuLabel(s)));
    const textLayerSkuCounts = countSkusFromText(pageText ?? "");
    const textLayerSplitByBase = new Map<string, string>();
    for (const sku of textLayerSkuSet) {
      if (!SPLIT_SUFFIX_RE.test(sku)) continue;
      const base = stripSplitSuffix(sku);
      if (base && !textLayerSplitByBase.has(base)) textLayerSplitByBase.set(base, sku);
    }
    const canonicalizeSkuWithText = (rawSku: string): string => {
      const normalized = normalizeSkuLabel(rawSku);
      if (!normalized) return normalized;

      const base = stripSplitSuffix(normalized);
      if (SPLIT_SUFFIX_RE.test(normalized)) {
        if (textLayerSkuSet.has(normalized)) return normalized; // SPLIT is explicitly in the plan text
        if (textLayerSkuSet.has(base)) return base; // AI artifact suffix, collapse to base label
        return normalized;
      }

      const splitVariant = textLayerSplitByBase.get(base);
      if (splitVariant) return splitVariant;
      if (textLayerSkuSet.has(normalized)) return normalized;

      const fuzzyTextMatch = textLayerSkus
        .map((sku) => normalizeSkuLabel(sku))
        .filter(Boolean)
        .filter((candidate) => {
          const longer = candidate.length >= normalized.length ? candidate : normalized;
          const shorter = candidate.length >= normalized.length ? normalized : candidate;
          if (!longer.startsWith(shorter)) return false;
          const tail = longer.slice(shorter.length);
          return tail.length > 0 && tail.length <= 2 && /^[A-Z0-9]+$/i.test(tail);
        })
        .sort((a, b) => b.length - a.length)[0];

      if (fuzzyTextMatch) {
        console.log(`Canonicalized near-match SKU: "${normalized}" → "${fuzzyTextMatch}"`);
        return fuzzyTextMatch;
      }

      return normalized;
    };

    if (textLayerSkus.length > 0) {
      console.log(`Text layer found ${textLayerSkus.length} SKUs: ${textLayerSkus.join(', ')}`);
    }

    // ═══════════════════════════════════════════════════════════
    // STEP 1: CLASSIFY THE PAGE (skipped when skipClassify=true)
    // Pre-Final always sends plan views, so classification is unnecessary.
    // ═══════════════════════════════════════════════════════════

    let rawPageType = "plan_view";
    let detectedUnitType: string | null = null;
    let isCommonArea = false;

    if (skipClassify) {
      // Skip classification entirely — assume plan_view, detect unit type from extraction
      console.log("Skipping classification (skipClassify=true, assuming plan_view)");
      rawPageType = "plan_view";
      // Detect common area from text hints
      const commonAreaPattern = /\b(LAUNDRY|MAIL\s*ROOM|RESTROOM|LOBBY|CLUBHOUSE|FITNESS|LEASING|BUSINESS\s*CENTER|POOL\s*BATH|TRASH|MAINTENANCE|MODEL|STORAGE|GARAGE|CORRIDOR|MECHANICAL|COMMUNITY|BREAK\s*ROOM)\b/i;
      isCommonArea = commonAreaPattern.test(pageText || '');
    } else if (classificationOverride) {
      const co = classificationOverride;
      rawPageType = String(co.pageType ?? "plan_view").toLowerCase().replace(/[\s_-]+/g, '_');
      detectedUnitType = co.unitTypeName ?? null;
      isCommonArea = co.isCommonArea ?? false;
      console.log("Using classification override (strip pass)");
    } else {
      const classifyPrompt = `Classify this 2020 Design shop drawing page.

PAGE TYPES (return one of these exact strings for pageType):
- "plan_view": Top-down bird's-eye view showing room layout with cabinet outlines and SKU labels on or near cabinet shapes. Walls appear as thick lines. You see the room from ABOVE. MIRRORED plan views (horizontally flipped) are STILL "plan_view".
- "elevation": Front/side view of cabinets. You see cabinet doors and drawers as tall rectangles. Dimension lines show heights (e.g. 32 7/8", 65 3/4"). Base cabinets sit on bottom, wall cabinets hang at top.
- "title_page": Cover page or title page with project info, unit type name, unit numbers list. No cabinet drawings visible.

COMMON AREAS (set isCommonArea to true for ANY of these):
Laundry, Mail Room, Restroom, Lobby, Clubhouse, Fitness Center, Leasing Office, Business Center, Pool Bath, Trash Room, Maintenance, Model, Storage, Garage, Corridor, Mechanical, Community Room, Break Room, Kitchen (Common), any non-residential space.

RESIDENTIAL (set isCommonArea to false):
Type 1, Type 2, Type 3, Studio, 1 Bed, 2 Bed, 1BR, 2BR, Unit A, Unit B, any numbered/lettered residential unit type including AS and MIRROR variants.

UNIT TYPE NAME: Look in the title block, header, sheet title, or prominent labels on this page.
Common formats: "3BR TYPE C-MIRROR", "2BR TYPE B1", "TYPE 1 - AS", "TYPE 1 - MIRROR", "TYPE 2 - ADA", "TYPE 3 - AS", "TYPE B1", "TYPE C2", "Laundry", "Mail Room", etc.
IMPORTANT: Return the FULL type name exactly as written, INCLUDING bedroom-count prefixes like "1BR", "2BR", "3BR", "STUDIO".
  Example: "2BR TYPE B1" → return "2BR TYPE B1". "3BR TYPE C-MIRROR" → return "3BR TYPE C-MIRROR".
IMPORTANT: "TYPE B1" and "TYPE B" are DIFFERENT types. Do NOT drop trailing digits.
Return null for unitTypeName ONLY if you truly cannot find any unit type identifier.
${unitType ? `\nContext: current unit type is "${unitType}"` : ""}`;

      let classification: any = { pageType: "plan_view", unitTypeName: null, isCommonArea: false };
      try {
        classification = await callGemini(GEMINI_API_KEY, "gemini-3-flash-preview", pageImage, classifyPrompt, 0.1, 1024, CLASSIFY_SCHEMA);
      } catch (e: any) {
        if (e.message === "rate_limit") return new Response(JSON.stringify({ error: "rate_limit" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        if (e.message === "credits") return new Response(JSON.stringify({ error: "credits" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        console.error("Step 1 classification error:", e.message);
      }
      rawPageType = String(classification.pageType ?? "plan_view").toLowerCase().replace(/[\s_-]+/g, '_');
      detectedUnitType = classification.unitTypeName ?? null;
      isCommonArea = classification.isCommonArea ?? false;
    }

    console.log(`Classification: pageType=${rawPageType}, unitType=${detectedUnitType}, isCommonArea=${isCommonArea}, skipClassify=${!!skipClassify}`);

    // ═══════════════════════════════════════════════════════════
    // DECISION: Extract SKUs only from plan views and common area elevations
    // ═══════════════════════════════════════════════════════════

    const isPlanView = rawPageType.includes("plan");
    const isElevation = rawPageType.includes("elev");
    const shouldExtract = isPlanView || (isElevation && isCommonArea);

    if (!shouldExtract) {
      console.log(`Skipping extraction: pageType=${rawPageType}, isCommonArea=${isCommonArea}`);
      return new Response(JSON.stringify({ items: [], unitTypeName: detectedUnitType, pageType: rawPageType, isCommonArea }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ═══════════════════════════════════════════════════════════
    // STEP 2: EXTRACT CABINET SKUs (focused, single-pass)
    // ═══════════════════════════════════════════════════════════

    const unitTypeDetectInstructions = skipClassify && !isStrip ? `
UNIT TYPE NAME: Also detect the unit type name from the title block, header, or prominent text on this page.
Look for formats like: "3BR TYPE C-MIRROR", "2BR TYPE B1", "TYPE 1 - AS", "TYPE A - MIRROR", "TYPE 2 - ADA", "TYPE B1", "TYPE C2", "Laundry", "Mail Room", etc.
IMPORTANT: Return the FULL type name exactly as written, INCLUDING bedroom-count prefixes like "1BR", "2BR", "3BR", "STUDIO".
  Example: If the title says "2BR TYPE B1" → return "2BR TYPE B1" (NOT just "TYPE B1").
  Example: If the title says "3BR TYPE C-MIRROR" → return "3BR TYPE C-MIRROR".
  Example: If the title says "STUDIO TYPE S1" → return "TYPE S1".
IMPORTANT: "TYPE B1" and "TYPE B" are DIFFERENT types. Do NOT drop trailing digits. "B1" is the full type code, not "B" with variant "1".
Return it as "unitTypeName" in your response. Return null if no unit type is found.
` : '';

    const extractPrompt = `Extract ALL cabinet SKU labels from this 2020 Design shop drawing plan view.
${unitTypeDetectInstructions}
For each cabinet found, provide:
1. sku: The SKU label exactly as written (e.g. B24, W3036, DB15, BF3, WF6X30, LS36-L, BLW36/3930-L, B09FH)
2. type: Classify by prefix:
   - "Base" → B, DB, SB, CB, EB, LS, LSB (but NOT BLW/BRW — those are Wall, NOT HAV — those are Vanity)
   - "Wall" → W, WDC, UB, WC, OH, BLW, BRW
   - "Tall" → T, UT, TC, PT, PTC, UC, HALC
   - "Vanity" → V, VB, VD, VDC, HAV (HAV = Vanity, NOT Base)
   - "Accessory" → FIL, BF, WF, BFFIL, WFFIL, TK, TKRUN, CM, LR, EP, FP, DWR, TF
3. room: From room labels on the plan (Kitchen, Bath, Laundry, Pantry — capitalize first letter only)
4. quantity: Count EVERY separate label occurrence of this SKU on this page

COUNTING — CRITICAL:
- If "DB15" label appears in TWO different spots → quantity 2
- If "BF3" label appears once → quantity 1. If "BF3" appears in TWO different spots → quantity 2. Do NOT skip small accessories.
- ACCESSORIES MATTER: BF3, BF6, WF3X30, WF6X30, DWR3, DWR6, FIL3 — count EVERY single one. Scan the ENTIRE drawing including corners, edges, and narrow gaps between cabinets. These labels often appear on BOTH sides of a kitchen run — check LEFT side AND RIGHT side of counter runs.
- BF (Base Filler) labels commonly appear in PAIRS — one on each end of a cabinet run. Scan every end-of-run and corner transition for BF labels.
- FILLER-HEAD CABINETS: B09FH, B06FH, B12FH — these are VERY NARROW rectangles (6"-12" wide). They appear as thin slivers between larger cabinets or at the end of a run. ACTIVELY LOOK FOR THESE — they are commonly missed.
- Corner cabinets (LS, LSB) at wall junction = count ONCE even if label appears at junction of two wall runs.
- Look for "xN" or "(2)" multiplier notation next to labels.

HAV PREFIX = VANITY (NOT Base):
- Any SKU starting with "HAV" (e.g. HAV3621BFH-REM) is a VANITY cabinet. Classify as type "Vanity", NOT "Base".
- Do NOT duplicate HAV items — report each HAV label exactly ONCE with the correct type "Vanity".

STACKED / ADJACENT LABELS — MOST COMMON ERROR:
- Two or more SKU labels near the same location are ALWAYS SEPARATE cabinets. NEVER merge them into one string.
- "W1230" on one line and "VDC2430" below it → TWO separate entries: W1230 (qty 1) AND VDC2430 (qty 1). NOT "W1230VDC2430".
- "W1530" near "BLW24/2730-R" → TWO separate entries. NOT "W1530-BLW24/2730-R".
- If two labels visually touch or OCR reads them with NO separator, split them into separate SKUs when both parts are valid labels.
- Example: "HCUC15X8HCOC3082D" means TWO entries: "HCUC15X8" and "HCOC3082D".
- Example: "HSS318XCHSS3032LB" means TWO entries: "HSS318X" and "CHSS3032LB".
- Example: "W1230VDC2430" means TWO entries: "W1230" and "VDC2430".

PRESERVE FULL SKU LABELS — CRITICAL:
- Report the COMPLETE label exactly as printed on the drawing, including ALL suffixes.
- "W1230-L" → report "W1230-L" (NOT "W1230")
- "W1230-R" → report "W1230-R" (NOT "W1230")
- "SB33-1D-REM" → report "SB33-1D-REM" (NOT "SB33")
- "LS36-L" → report "LS36-L" (NOT "LS36")
- "HAV3621BFH-REM" → report "HAV3621BFH-REM" (NOT "HAV3621")
- "W3324B-FB" → report "W3324B-FB" (NOT "W3324" or "W3324B")
- "W3030B" → report "W3030B" exactly as written
- Do NOT strip trailing letters, "-1D", "-2D", "-REM", "-L", "-R", "-FB" or any other suffix.
- Each unique label on the drawing = one unique SKU entry. Do NOT report both a truncated and full version.

SKIP THESE — NOT CABINET SKUs:
- Appliances: REF, REFRIG, DW, DISHWASHER, RANGE, HOOD, MICRO, OTR, OVEN, VENT, DISP, CKT
- Sheet/callout references: B1/A4-403, A404, A3-201, B2/A5-100 (contain "/" or don't match cabinet prefix)
- Non-SKU text: unit numbers, elevation titles, dimension text, page numbers

VALID SKU PREFIXES (a label must start with letters followed by a digit):
B, DB, SB, CB, EB, LS, LSB, W, WDC, UB, WC, OH, BLW, BRW, T, TF, UT, TC, PT, PTC, UC, V, VB, VD, VDC, FIL, BF, WF, BFFIL, WFFIL, TK, TKRUN, CM, LR, EP, FP, DWR
Also accept manufacturer-specific longer prefixes (e.g. HA, HAV, HALC, SA, SV) followed by digits.

VALID NO-DIGIT SKUS:
UC, SCRIBE, BP

FINAL SWEEP: After your initial scan, go back and specifically look for: B09FH, B06FH, B12FH, BF3, BF6, WF3X30, WF6X30, TF3X96, DWR3, DWR6, CM8, TK, TKRUN, EP, LR, UC, SCRIBE, BP. These appear as very small labels on narrow shapes.
${isStrip ? '\nNOTE: This image shows a CROPPED SECTION of a larger drawing page. Extract all cabinet labels visible in this cropped section.\n' : ''}${textLayerSkus.length > 0 ? `\nTEXT LAYER CROSS-REFERENCE — the PDF text layer detected these SKUs on this page:\n${textLayerSkus.join(', ')}\nMake sure ALL of these appear in your results if they are visible as labels on the drawing. If any are missing from your results, look harder for them.\n` : ''}${unitType ? `\nUnit type context: ${unitType}` : ""}
If no cabinet SKUs are found, return {"items":[]}`;

    let extracted: any = { items: [] };
    try {
      extracted = await callGemini(GEMINI_API_KEY, "gemini-3-flash-preview", pageImage, extractPrompt, 0.2, 8192, EXTRACT_SCHEMA);
    } catch (e: any) {
      if (e.message === "rate_limit") return new Response(JSON.stringify({ error: "rate_limit" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (e.message === "credits") return new Response(JSON.stringify({ error: "credits" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      console.error("Step 2 extraction error:", e.message);
    }

    const rawItems = extracted.items ?? [];
    // When skipClassify, the extraction also returns unitTypeName
    if (skipClassify && !isStrip && extracted.unitTypeName) {
      detectedUnitType = extracted.unitTypeName;
    }
    let finalItems = splitMergedSkus(rawItems, textLayerSkus);
    console.log(`Step 2: ${rawItems.length} raw → ${finalItems.length} after split`);

    // ── RECOVERY: If extraction is empty but text layer has SKUs ──
    // This catches MIRROR pages and cases where the AI fails to read labels.
    // Seed with qty=1 each (text counts are unreliable due to legends/notes).
    if (!isStrip && finalItems.length === 0 && textLayerSkus.length > 0) {
      console.log(`Extraction empty but text layer has ${textLayerSkus.length} SKUs — seeding with qty=1`);
      for (const sku of textLayerSkus) {
        if (isValidSku(sku)) {
          finalItems.push({ sku, type: classifySku(sku), room: "Kitchen", quantity: 1 });
        }
      }
      console.log(`Text layer seed: ${finalItems.length} items`);
    }

    console.log(`Final: ${finalItems.length} items`);

    // ── Normalize and filter ──
    let items = finalItems
      .filter((c: any) => c.sku && /^[A-Za-z]/.test(c.sku) && (/\d/.test(c.sku) || NO_DIGIT_OK.test(String(c.sku).trim())))
      .filter((c: any) => {
        const upper = String(c.sku).toUpperCase().trim();
        if (APPLIANCE_RE.test(upper)) return false;
        if (/^UNIT\b/i.test(upper)) return false;
        if (/^ELEV/i.test(upper)) return false;
        if (/^FLOOR/i.test(upper)) return false;
        if (/^TYPE\s/i.test(upper)) return false;
        if (/^WALL\s+[A-Z]$/i.test(upper)) return false;
        if (/^[A-Z]\d?-[A-Z]/i.test(upper) && upper.length <= 4) return false;
        // Filter callout / sheet references containing "/"
        if (upper.includes('/') && !(/^(BLW|BRW)\d/i.test(upper))) return false;
        // Must match a known cabinet prefix
        if (!SKU_PREFIX_RE.test(upper) && !NO_DIGIT_OK.test(upper)) return false;
        return true;
      })
      .map((c: any) => {
        let sku = canonicalizeSkuWithText(String(c.sku ?? ''));
        // Fix AI-merged adjacent labels using text layer (e.g. "RW1230" → "W1230")
        if (textLayerSkuSet.size > 0) {
          sku = fixMergedAdjacentLabel(sku, textLayerSkuSet);
        }
        // Preserve full SKU labels exactly as written; collapse SPLIT only when not present in plan text.
        let rawType = String(c.type ?? "Base").trim();
        if (/^BLW|^BRW/i.test(sku)) rawType = "Wall";
        if (/^WDC\d/i.test(sku)) rawType = "Wall";
        if (/^HAV\d/i.test(sku)) rawType = "Vanity";
        if (/^HALC\d/i.test(sku)) rawType = "Tall";
        const normalizedType = rawType.charAt(0).toUpperCase() + rawType.slice(1).toLowerCase();
        const rawRoom = String(c.room ?? "Kitchen").trim();
        const normalizedRoom = rawRoom.charAt(0).toUpperCase() + rawRoom.slice(1).toLowerCase();
        return { sku, type: normalizedType, room: normalizedRoom, quantity: Number(c.quantity) || 1 };
      });

    // Strip passes: text layer helps validation, but must not suppress real SKUs missing from OCR text.
    if (isStrip && textLayerSkuSet.size > 0) {
      const before = items.length;
      let keptByStrongPattern = 0;
      items = items.filter((item) => {
        if (textLayerSkuSet.has(item.sku)) return true;

        // Prefix/suffix tolerant match (e.g. W3030 vs W3030B)
        for (const tlSku of textLayerSkuSet) {
          if (item.sku.startsWith(tlSku) || tlSku.startsWith(item.sku)) return true;
        }

        // OCR text layer can miss tiny labels (UC, TF3X96, narrow fillers).
        if (STRONG_STRIP_SKU_RE.test(item.sku)) {
          keptByStrongPattern += 1;
          return true;
        }

        return false;
      });

      if (before !== items.length) {
        console.log(`Strip text-layer filter removed ${before - items.length} unsupported SKUs`);
      }
      if (keptByStrongPattern > 0) {
        console.log(`Strip validation kept ${keptByStrongPattern} OCR-missing strong SKUs`);
      }
    }

    // Reconcile under-counted small accessories using text-layer occurrence counts (conservative floor).
    const ACCESSORY_FLOOR_RE = /^(BF|WF|FIL|BFFIL|WFFIL|TK|TKRUN|CM|LR|EP|FP|DWR|TF)\d/i;
    items = items.map((item) => {
      const textCount = textLayerSkuCounts[item.sku] ?? 0;
      if (!ACCESSORY_FLOOR_RE.test(item.sku) || textCount < 2) return item;
      const nextQty = Math.min(Math.max(item.quantity, textCount), 6);
      if (nextQty !== item.quantity) {
        console.log(`Accessory qty floor from text layer: ${item.sku} ${item.quantity} → ${nextQty}`);
      }
      return { ...item, quantity: nextQty };
    });

    // Cap non-accessory quantities using text-layer occurrence counts.
    // The text layer is a reliable upper bound for plan-view labels.
    items = items.map((item) => {
      if (ACCESSORY_FLOOR_RE.test(item.sku)) return item; // accessories handled above
      // Check exact SKU count and also base SKU (without -L/-R suffix) count
      const exactCount = textLayerSkuCounts[item.sku] ?? 0;
      const baseSku = item.sku.replace(/-[A-Z]+$/i, '');
      const baseCount = baseSku !== item.sku ? (textLayerSkuCounts[baseSku] ?? 0) : 0;
      const textCount = Math.max(exactCount, baseCount);
      if (textCount > 0 && item.quantity > textCount) {
        console.log(`Non-accessory qty cap: ${item.sku} ${item.quantity} → ${textCount} (text layer)`);
        return { ...item, quantity: textCount };
      }
      return item;
    });

    // ── Reassemble split dimension SKUs ──
    // AI may return "UC15" and "X84" as separate items when the real SKU is "UC15X84".
    // Merge them back: if item N is a prefix SKU and item N+1 starts with "X" + digits,
    // combine into one dimension-pattern SKU.
    {
      const reassembled: typeof items = [];
      const consumed = new Set<number>();
      for (let i = 0; i < items.length; i++) {
        if (consumed.has(i)) continue;
        const cur = items[i];
        // Look for a following "X##" item (bare dimension suffix) in same room
        if (i + 1 < items.length && !consumed.has(i + 1)) {
          const next = items[i + 1];
          if (/^X\d+$/i.test(next.sku) && cur.room === next.room) {
            const merged = cur.sku + next.sku;
            console.log(`Reassembled dimension SKU: "${cur.sku}" + "${next.sku}" → "${merged}"`);
            reassembled.push({ ...cur, sku: merged });
            consumed.add(i + 1);
            continue;
          }
        }
        // Also check if current is "X##" and previous wasn't consumed — skip standalone X## entries
        if (/^X\d+$/i.test(cur.sku)) {
          console.log(`Filtered standalone dimension suffix: ${cur.sku}`);
          continue;
        }
        reassembled.push(cur);
      }
      items = reassembled;
    }

    // Filter out SKUs that don't match any known cabinet prefix pattern
    // and are not confirmed by the text layer (prevents fabricated SKUs like PSX23H)
    items = items.filter((item) => {
      if (SKU_PATTERN.test(item.sku)) { SKU_PATTERN.lastIndex = 0; return true; }
      SKU_PATTERN.lastIndex = 0;
      if (NO_DIGIT_OK.test(item.sku)) return true;
      if (textLayerSkuSet.has(item.sku)) return true;
      // Check prefix match in text layer
      for (const tlSku of textLayerSkuSet) {
        if (item.sku.startsWith(tlSku) || tlSku.startsWith(item.sku)) return true;
      }
      console.log(`Filtered unknown-prefix SKU not in text layer: ${item.sku}`);
      return false;
    });

    // ── Merge truncated SKUs into suffixed variants ──
    // When a label is partially hidden (e.g., "W1230-L" cut off → "W1230"), the AI may
    // return both "W1230" (truncated) and "W1230-R" or "W1230-L" as separate entries.
    // Also handles "+" suffixes (e.g., HCDB18 absorbed into HCDB18+CE).
    // Absorb bare SKU into suffixed variant(s) across ALL rooms to prevent duplicates.
    const hasSuffix = (sku: string) => /[-+][A-Z0-9]+$/i.test(sku);
    const getBase = (sku: string) => sku.replace(/[-+][A-Z0-9]+$/i, '');
    const suffixed = items.filter(i => hasSuffix(i.sku));
    const bare = items.filter(i => !hasSuffix(i.sku));
    const absorbedBare = new Set<number>();
    for (let bi = 0; bi < bare.length; bi++) {
      const bareSku = bare[bi].sku;
      const bareQty = bare[bi].quantity;
      // Check if any suffixed variant starts with this bare SKU + separator
      const variants = suffixed.filter(s => getBase(s.sku) === bareSku);
      if (variants.length > 0 && bareQty <= 1) {
        absorbedBare.add(bi);
        console.log(`Merged truncated SKU "${bareSku}" (qty ${bareQty}) into suffixed variant(s) [${variants.map(v=>v.sku).join(',')}]`);
      }
    }
    // Also absorb misread suffixed variants into each other when they share the same base
    // e.g., HCDB18-S (misread) absorbed into HCDB18+CE (correct) if text layer confirms
    const absorbedSuffixed = new Set<number>();
    for (let si = 0; si < suffixed.length; si++) {
      if (absorbedSuffixed.has(si)) continue;
      const base = getBase(suffixed[si].sku);
      if (!base) continue;
      // If this suffixed SKU is NOT in the text layer but another variant with same base IS, absorb it
      const inTextLayer = textLayerSkuSet.has(suffixed[si].sku);
      if (inTextLayer) continue;
      const betterVariant = suffixed.find((s, idx) => idx !== si && !absorbedSuffixed.has(idx) && getBase(s.sku) === base && textLayerSkuSet.has(s.sku));
      if (betterVariant && suffixed[si].quantity <= 1) {
        absorbedSuffixed.add(si);
        console.log(`Absorbed misread variant "${suffixed[si].sku}" into text-confirmed "${betterVariant.sku}"`);
      }
    }
    const mergedItems: typeof items = [];
    for (let bi = 0; bi < bare.length; bi++) {
      if (!absorbedBare.has(bi)) mergedItems.push(bare[bi]);
    }
    for (let si = 0; si < suffixed.length; si++) {
      if (!absorbedSuffixed.has(si)) mergedItems.push(suffixed[si]);
    }
    items = mergedItems;

    // ── Deduplicate ──
    // For most SKUs, duplicate entries are summed (multiple distinct labels on page).
    // For corner units, HAV vanities, and manufacturer dimension SKUs, duplicate detections are usually
    // the same physical cabinet repeated across passes, so keep MAX instead of SUM.
    const isMaxDedupSku = (sku: string) => /^(LS|LSB|HAV)\d+/i.test(sku) || /^(HCUC|HCOC)\d+X?\d*[A-Z0-9]*$/i.test(sku);
    const deduped = new Map<string, { sku: string; type: string; room: string; quantity: number }>();
    for (const item of items) {
      const key = `${item.sku}|${item.room}`;
      const existing = deduped.get(key);
      if (existing) {
        existing.quantity = isMaxDedupSku(item.sku)
          ? Math.max(existing.quantity, item.quantity)
          : existing.quantity + item.quantity;
      } else {
        deduped.set(key, { ...item });
      }
    }

    return new Response(JSON.stringify({ items: Array.from(deduped.values()), unitTypeName: detectedUnitType, pageType: rawPageType, isCommonArea }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("extract-pdf-labels error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
