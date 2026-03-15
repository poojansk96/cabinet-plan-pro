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
  // Model fallback: try primary model 3 times, then fallback to gemini-2.5-pro 3 times
  const MODELS = [model, "gemini-2.5-pro"];
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
        console.error("Structured output parse failed:", text.slice(0, 500));
        return {};
      }
    }
  }

  return text;
}

// ── SKU Helpers ──

const SKU_PATTERN = /\b(B|DB|SB|CB|EB|LS|LSB|W|UB|WC|OH|BLW|BRW|T|UT|TC|PT|PTC|UC|V|VB|VD|VDC|FIL|BF|WF|BFFIL|WFFIL|TK|TKRUN|CM|LR|EP|FP|DWR|HA|HAV|HALC|HAL|SA|SV)\d[\w\-\/]*/gi;
const APPLIANCE_RE = /^(REF|REFRIG|REFRIGERATOR|DW(?!R)|DDW|DISHWASHER|DISHW|RANGE|HOOD|MICRO|OTR|OVEN|COOK|STOVE|MW|WM|WASHER|DRYER|FREEZER|WINE|ICE|TRASH|COMPACT|SINK|FAN|VENT|DISP|CKT)/i;
// Relaxed: accept any 1-8 letter prefix followed by a digit (catches manufacturer-specific SKUs like HAV, HALC)
const SKU_PREFIX_RE = /^[A-Z]{1,8}\d/i;
const NO_DIGIT_OK = /^(BP|SCRIBE)$/i;

function isValidSku(s: string): boolean {
  const upper = s.toUpperCase().trim();
  if (!upper || upper.length < 2) return false;
  if (APPLIANCE_RE.test(upper)) return false;
  if (/^UNIT\b/i.test(upper) || /^ELEV/i.test(upper) || /^FLOOR/i.test(upper) || /^TYPE\s/i.test(upper)) return false;
  if (upper.includes('/') && !(/^(BLW|BRW)\d/i.test(upper))) return false;
  return SKU_PREFIX_RE.test(upper);
}

function extractSkusFromText(pageText: string): string[] {
  if (!pageText) return [];
  const matches = pageText.match(SKU_PATTERN) || [];
  const skus = new Set<string>();
  for (const m of matches) {
    const upper = m.toUpperCase().trim();
    if (APPLIANCE_RE.test(upper)) continue;
    if (/^UNIT\b/i.test(upper) || /^ELEV/i.test(upper) || /^FLOOR/i.test(upper) || /^TYPE\s/i.test(upper)) continue;
    skus.add(upper);
  }
  return [...skus];
}

function classifySku(sku: string): string {
  if (/^(BLW|BRW)/i.test(sku)) return "Wall";
  if (/^(W|UB|WC|OH)\d/i.test(sku)) return "Wall";
  if (/^(T|UT|TC|PT|PTC|UC)\d/i.test(sku)) return "Tall";
  if (/^(V|VB|VD|VDC)\d/i.test(sku)) return "Vanity";
  if (/^(FIL|BF|WF|BFFIL|WFFIL|TK|TKRUN|CM|LR|EP|FP|DWR)\d/i.test(sku)) return "Accessory";
  return "Base";
}

// Split ONLY on explicit hyphens where both parts are valid SKUs
// Removed concatenation splitting entirely — prevents hallucinated double SKUs
function splitMergedSkus(items: any[]): any[] {
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
          result.push({ ...item, sku: left, type: classifySku(left), quantity: 1 });
          result.push({ ...item, sku: right, type: classifySku(right), quantity: 1 });
          wasSplit = true;
          break;
        }
      }
    }

    if (!wasSplit) result.push(item);
  }
  return result;
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

    const { pageImage, unitType, pageText, speedMode, classificationOverride, isStrip } = await req.json();

    if (!pageImage || typeof pageImage !== "string") {
      return new Response(JSON.stringify({ error: "pageImage (base64 string) required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Extract SKUs from PDF text layer (instant, no AI needed)
    const textLayerSkus = extractSkusFromText(pageText ?? "");
    if (textLayerSkus.length > 0) {
      console.log(`Text layer found ${textLayerSkus.length} SKUs: ${textLayerSkus.join(', ')}`);
    }

    // ═══════════════════════════════════════════════════════════
    // STEP 1: CLASSIFY THE PAGE (The Gatekeeper)
    // Isolates the page-type decision from extraction to prevent
    // the AI from struggling with complex negative constraints.
    // ═══════════════════════════════════════════════════════════

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
Common formats: "TYPE 1 - AS", "TYPE 1 - MIRROR", "TYPE 2 - ADA", "TYPE 3 - AS", "Laundry", "Mail Room", etc.
Return null for unitTypeName ONLY if you truly cannot find any unit type identifier.
${unitType ? `\nContext: current unit type is "${unitType}"` : ""}`;

    let classification: any;
    if (classificationOverride) {
      classification = classificationOverride;
      console.log("Using classification override (strip pass)");
    } else {
      classification = { pageType: "plan_view", unitTypeName: null, isCommonArea: false };
      try {
        classification = await callGemini(GEMINI_API_KEY, "gemini-3-flash-preview", pageImage, classifyPrompt, 0.1, 1024, CLASSIFY_SCHEMA);
      } catch (e: any) {
        if (e.message === "rate_limit") return new Response(JSON.stringify({ error: "rate_limit" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        if (e.message === "credits") return new Response(JSON.stringify({ error: "credits" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        console.error("Step 1 classification error:", e.message);
      }
    }

    const rawPageType = String(classification.pageType ?? "plan_view").toLowerCase().replace(/[\s_-]+/g, '_');
    const detectedUnitType = classification.unitTypeName ?? null;
    const isCommonArea = classification.isCommonArea ?? false;
    console.log(`Step 1 Classification: pageType=${rawPageType}, unitType=${detectedUnitType}, isCommonArea=${isCommonArea}`);

    // ═══════════════════════════════════════════════════════════
    // DECISION: Extract SKUs only from plan views and common area elevations
    // Residential elevations are SKIPPED (same cabinets as plan view → double-count)
    // ═══════════════════════════════════════════════════════════

    const isPlanView = rawPageType.includes("plan");
    const isElevation = rawPageType.includes("elev");
    const isTitlePage = rawPageType.includes("title");
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

    const extractPrompt = `Extract ALL cabinet SKU labels from this 2020 Design shop drawing page.

For each cabinet found, provide:
1. sku: The SKU label exactly as written (e.g. B24, W3036, DB15, BF3, WF6X30, LS36-L, BLW36/3930-L, B09FH)
2. type: Classify by prefix:
   - "Base" → B, DB, SB, CB, EB, LS, LSB (but NOT BLW/BRW — those are Wall)
   - "Wall" → W, UB, WC, OH, BLW, BRW
   - "Tall" → T, UT, TC, PT, PTC, UC
   - "Vanity" → V, VB, VD, VDC
   - "Accessory" → FIL, BF, WF, BFFIL, WFFIL, TK, TKRUN, CM, LR, EP, FP, DWR
3. room: From room labels on the plan (Kitchen, Bath, Laundry, Pantry — capitalize first letter only)
4. quantity: Count EVERY separate label occurrence of this SKU on this page

COUNTING — CRITICAL:
- If "DB15" label appears in TWO different spots → quantity 2
- If "BF3" label appears once → quantity 1. Do NOT skip small accessories.
- ACCESSORIES MATTER: BF3, BF6, WF3X30, WF6X30, DWR3, DWR6, FIL3 — count EVERY single one. Scan the ENTIRE drawing including corners, edges, and narrow gaps between cabinets.
- FILLER-HEAD CABINETS: B09FH, B06FH, B12FH — these are VERY NARROW rectangles (6"-12" wide). They appear as thin slivers between larger cabinets or at the end of a run. ACTIVELY LOOK FOR THESE — they are commonly missed.
- Corner cabinets (LS, LSB) at wall junction = count ONCE even if label appears at junction of two wall runs.
- Look for "xN" or "(2)" multiplier notation next to labels.

STACKED / ADJACENT LABELS — MOST COMMON ERROR:
- Two or more SKU labels near the same location are ALWAYS SEPARATE cabinets. NEVER merge them into one string.
- "W1230" on one line and "VDC2430" below it → TWO separate entries: W1230 (qty 1) AND VDC2430 (qty 1). NOT "W1230VDC2430".
- "W1530" near "BLW24/2730-R" → TWO separate entries. NOT "W1530-BLW24/2730-R".

DOOR CONFIGURATION SUFFIXES — STRIP THESE:
- "SB36B-1D", "B33-1D", "B24-2D" → report base SKU only: "SB36", "B33", "B24"
- Trailing "B" after digits: "W3018B" → report "W3018"

SKIP THESE — NOT CABINET SKUs:
- Appliances: REF, REFRIG, DW, DISHWASHER, RANGE, HOOD, MICRO, OTR, OVEN, VENT, DISP, CKT
- Sheet/callout references: B1/A4-403, A404, A3-201, B2/A5-100 (contain "/" or don't match cabinet prefix)
- Non-SKU text: unit numbers, elevation titles, dimension text, page numbers

VALID SKU PREFIXES (a label must start with letters followed by a digit):
B, DB, SB, CB, EB, LS, LSB, W, UB, WC, OH, BLW, BRW, T, UT, TC, PT, PTC, UC, V, VB, VD, VDC, FIL, BF, WF, BFFIL, WFFIL, TK, TKRUN, CM, LR, EP, FP, DWR
Also accept manufacturer-specific longer prefixes (e.g. HA, HAV, HALC, SA, SV) followed by digits.

FINAL SWEEP: After your initial scan, go back and specifically look for: B09FH, B06FH, B12FH, BF3, BF6, WF3X30, WF6X30, DWR3, DWR6, CM8, TK, TKRUN, EP, LR, SCRIBE, BP. These appear as very small labels on narrow shapes.
${isStrip ? '\nNOTE: This image shows a CROPPED SECTION of a larger drawing page. Extract all cabinet labels visible in this cropped section.\n' : ''}${textLayerSkus.length > 0 ? `\nTEXT LAYER CROSS-REFERENCE — the PDF text layer detected these SKUs on this page:\n${textLayerSkus.join(', ')}\nMake sure ALL of these appear in your results if they are visible as labels on the drawing. If any are missing from your results, look harder for them.\n` : ''}${unitType ? `\nUnit type context: ${unitType}` : ""}
If no cabinet SKUs are found, return {"items":[]}`;

    let extracted: any = { items: [] };
    try {
      extracted = await callGemini(GEMINI_API_KEY, "gemini-3-flash-preview", pageImage, extractPrompt, 0.1, 8192, EXTRACT_SCHEMA);
    } catch (e: any) {
      if (e.message === "rate_limit") return new Response(JSON.stringify({ error: "rate_limit" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (e.message === "credits") return new Response(JSON.stringify({ error: "credits" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      console.error("Step 2 extraction error:", e.message);
    }

    const rawItems = extracted.items ?? [];
    let finalItems = splitMergedSkus(rawItems);
    console.log(`Step 2: ${rawItems.length} raw → ${finalItems.length} after split`);

    // ── RECOVERY: If extraction is empty but text layer has SKUs ──
    // This catches MIRROR pages and cases where the AI fails to read labels.
    // Seed with qty=1 each (text counts are unreliable due to legends/notes).
    if (finalItems.length === 0 && textLayerSkus.length > 0) {
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
    const items = finalItems
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
        let sku = String(c.sku).toUpperCase().trim().replace(/\s*-\s*/g, '-').replace(/\s+/g, '');
        // Strip door-configuration suffixes: "-1D", "-2D", "B-1D", "B-2D"
        sku = sku.replace(/B?-\d+D$/i, '');
        // Strip trailing "B" door-config suffix (W3018B→W3018, SB33B→SB33)
        sku = sku.replace(/(\d)B$/i, '$1');
        let rawType = String(c.type ?? "Base").trim();
        if (/^BLW|^BRW/i.test(sku)) rawType = "Wall";
        const normalizedType = rawType.charAt(0).toUpperCase() + rawType.slice(1).toLowerCase();
        const rawRoom = String(c.room ?? "Kitchen").trim();
        const normalizedRoom = rawRoom.charAt(0).toUpperCase() + rawRoom.slice(1).toLowerCase();
        return { sku, type: normalizedType, room: normalizedRoom, quantity: Number(c.quantity) || 1 };
      });

    // ── Deduplicate — SUM quantities instead of MAX ──
    // If the AI lists the same SKU twice (found in different spots), we ADD the quantities.
    // Exception: Corner lazy susans (LS, LSB) use MAX since they sit at wall junctions.
    const isCornerLazySusan = (sku: string) => /^(LS|LSB)\d+/i.test(sku);
    const deduped = new Map<string, { sku: string; type: string; room: string; quantity: number }>();
    for (const item of items) {
      const key = `${item.sku}|${item.room}`;
      const existing = deduped.get(key);
      if (existing) {
        existing.quantity = isCornerLazySusan(item.sku)
          ? Math.max(existing.quantity, item.quantity)
          : existing.quantity + item.quantity;  // SUM quantities!
      } else {
        deduped.set(key, { ...item });
      }
    }

    return new Response(JSON.stringify({ items: Array.from(deduped.values()), unitTypeName: detectedUnitType }), {
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
