import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Helpers ──

function extractJson(raw: string): any {
  let cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
  const firstBrace = cleaned.indexOf('{');
  if (firstBrace !== -1) cleaned = cleaned.substring(firstBrace);
  try { return JSON.parse(cleaned); } catch {}
  // Recover truncated JSON
  const itemsMatch = cleaned.match(/"items"\s*:\s*\[/);
  if (itemsMatch) {
    const arrStart = cleaned.indexOf('[', cleaned.indexOf('"items"'));
    const lastCompleteItem = cleaned.lastIndexOf('}');
    if (arrStart !== -1 && lastCompleteItem > arrStart) {
      const itemsStr = cleaned.substring(arrStart, lastCompleteItem + 1) + ']';
      const typeMatch = cleaned.match(/"unitTypeName"\s*:\s*"([^"]*?)"/);
      const unitTypeName = typeMatch ? typeMatch[1] : null;
      try {
        const items = JSON.parse(itemsStr);
        console.log(`Recovered ${items.length} items from truncated JSON`);
        return { unitTypeName, items };
      } catch {}
    }
  }
  let attempt = cleaned;
  for (let i = 0; i < 5; i++) {
    attempt += ']}';
    try { return JSON.parse(attempt); } catch {}
  }
  throw new Error("Could not parse JSON");
}

async function callGemini(
  apiKey: string,
  model: string,
  pageImage: string,
  prompt: string,
  temperature = 0.1,
  maxTokens = 8192,
): Promise<string> {
  const MAX_RETRIES = 3;
  let response: Response | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      response = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ role: "user", parts: [
              { inlineData: { mimeType: "image/jpeg", data: pageImage } },
              { text: prompt },
            ]}],
            generationConfig: { temperature, maxOutputTokens: maxTokens },
          }),
        },
      );
    } catch (fetchErr) {
      console.error(`AI fetch error (attempt ${attempt + 1}):`, fetchErr);
      if (attempt < MAX_RETRIES - 1) { await new Promise(r => setTimeout(r, 2000 * (attempt + 1))); continue; }
      throw fetchErr;
    }

    if (response.status === 503 || response.status === 500) {
      console.warn(`AI unavailable (${response.status}), attempt ${attempt + 1}/${MAX_RETRIES}`);
      response = null;
      if (attempt < MAX_RETRIES - 1) { await new Promise(r => setTimeout(r, 3000 * (attempt + 1))); continue; }
      throw new Error("AI model temporarily unavailable");
    }
    break;
  }

  if (!response) throw new Error("AI model temporarily unavailable");
  if (response.status === 429) throw new Error("rate_limit");
  if (response.status === 402) throw new Error("credits");
  if (!response.ok) {
    const errText = await response.text();
    console.error("AI gateway error:", response.status, errText);
    throw new Error(`AI error: ${response.status}`);
  }

  const aiData = await response.json();
  return aiData.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

// SKU patterns for text-layer extraction
const SKU_PATTERN = /\b(B|DB|SB|CB|EB|LS|LSB|W|UB|WC|OH|BLW|BRW|T|UT|TC|PT|PTC|UC|V|VB|VD|VDC|FIL|BF|WF|BFFIL|WFFIL|TK|TKRUN|CM|LR|EP|FP|DWR)\d[\w\-\/]*/gi;
const APPLIANCE_RE = /^(REF|REFRIG|REFRIGERATOR|DW(?!R)|DDW|DISHWASHER|DISHW|RANGE|HOOD|MICRO|OTR|OVEN|COOK|STOVE|MW|WM|WASHER|DRYER|FREEZER|WINE|ICE|TRASH|COMPACT|SINK|FAN|VENT|DISP|CKT)/i;
const SKU_PREFIX_RE = /^(BLW|BRW|DB|SB|CB|EB|LSB|LS|BFFIL|WFFIL|TKRUN|TK|BF|WF|FIL|CM|LR|EP|FP|DWR|VDC|VB|VD|WC|UB|OH|PTC|PT|UTC|UT|TC|UC|W|T|V|B)\d/i;

function isValidSku(s: string): boolean {
  const upper = s.toUpperCase().trim();
  if (!upper || upper.length < 2) return false;
  if (APPLIANCE_RE.test(upper)) return false;
  if (/^UNIT\b/i.test(upper) || /^ELEV/i.test(upper) || /^FLOOR/i.test(upper) || /^TYPE\s/i.test(upper)) return false;
  return SKU_PREFIX_RE.test(upper);
}

// Returns both unique SKUs and occurrence counts for quantity cross-referencing
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

function extractSkuCounts(pageText: string): Map<string, number> {
  if (!pageText) return new Map();
  const matches = pageText.match(SKU_PATTERN) || [];
  const counts = new Map<string, number>();
  for (const m of matches) {
    const upper = m.toUpperCase().trim();
    if (APPLIANCE_RE.test(upper)) continue;
    if (/^UNIT\b/i.test(upper) || /^ELEV/i.test(upper) || /^FLOOR/i.test(upper) || /^TYPE\s/i.test(upper)) continue;
    counts.set(upper, (counts.get(upper) || 0) + 1);
  }
  return counts;
}

function classifySku(sku: string): string {
  if (/^(BLW|BRW)/i.test(sku)) return "Wall";
  if (/^(W|UB|WC|OH)\d/i.test(sku)) return "Wall";
  if (/^(T|UT|TC|PT|PTC|UC)\d/i.test(sku)) return "Tall";
  if (/^(V|VB|VD|VDC)\d/i.test(sku)) return "Vanity";
  if (/^(FIL|BF|WF|BFFIL|WFFIL|TK|TKRUN|CM|LR|EP|FP|DWR)\d/i.test(sku)) return "Accessory";
  return "Base";
}

// Strip trailing -L or -R suffix (installation handedness) for dedup/comparison.
// In 2020 Design, B18-R and B18-L are the same cabinet part — handedness is install-time.
function getBaseSku(sku: string): string {
  return sku.replace(/-(L|R)$/i, '');
}


// Split merged/concatenated SKUs that the AI incorrectly combined
// e.g. "W1530-BLW24/2730-R" → ["W1530-L", "BLW24/2730-R"] or ["W1530", "BLW24/2730-R"]
// e.g. "W1230WDC2430" → ["W1230", "WDC2430"]
function splitMergedSkus(items: any[]): any[] {
  const result: any[] = [];
  for (const item of items) {
    const sku = String(item?.sku ?? '').toUpperCase().trim();
    if (!sku) { result.push(item); continue; }

    let wasSplit = false;

    // Try splitting on hyphen boundaries where both parts look like valid SKUs
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

    // If no hyphen split, try concatenation split (no separator)
    if (!wasSplit) {
      const plain = sku.replace(/-/g, '');
      for (let pos = 2; pos < plain.length - 1; pos++) {
        const left = plain.substring(0, pos);
        const right = plain.substring(pos);
        if (isValidSku(left) && isValidSku(right)) {
          console.log(`Split concatenated SKU: "${sku}" → "${left}" + "${right}"`);
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

// ── Main handler ──

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not configured");

    const { pageImage, unitType, pageText, speedMode } = await req.json();
    const isFastMode = speedMode === 'fast';

    if (!pageImage || typeof pageImage !== "string") {
      return new Response(JSON.stringify({ error: "pageImage (base64 string) required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Extract SKUs from PDF text layer (instant, no AI needed) ──
    const textLayerSkus = extractSkusFromText(pageText ?? "");
    if (textLayerSkus.length > 0) {
      console.log(`Text layer found ${textLayerSkus.length} SKUs: ${textLayerSkus.join(', ')}`);
    }


    // ── PASS 1: Primary extraction with gemini-2.5-pro ──
    const prompt = `You are an expert millwork estimator reading a 2020 Design shop drawing page.

These are 2020 Design software shop drawings. They contain THREE types of pages:

PAGE TYPES:
  A) TITLE PAGE / COVER PAGE — contains project info, unit type name, unit numbers. No cabinet drawings.
  B) PLAN VIEW PAGE (top-down view) — shows cabinets from ABOVE as rectangular outlines with SKU labels written on or next to each cabinet. Walls appear as thick lines. You see the room layout from a bird's-eye perspective. Cabinet SKU labels like "B24", "W3030B", "DB15", "BF3" are placed directly on/near the cabinet shapes.
  C) ELEVATION PAGE (front/side view) — shows cabinets as you would see them standing in front of them. Rectangular boxes stacked vertically (base on bottom, wall on top). Has dimension lines showing heights.

WHAT TO DO FOR EACH PAGE TYPE:
- TITLE PAGE → return {"unitTypeName":"<detected type>","items":[]}
- PLAN VIEW PAGE → EXTRACT all cabinet SKU labels AND detect the unit type name from the page title/header
- ELEVATION PAGE → DO NOT extract. Return {"unitTypeName":null,"items":[]}
  *** Elevation pages show the SAME cabinets already visible on plan view pages. Extracting from both would cause double-counting. Only extract from PLAN VIEW pages. ***

HOW TO TELL PLAN VIEW vs ELEVATION:
- PLAN VIEW: You look DOWN at the room. Cabinets are flat rectangular outlines along walls. Labels are placed inside or beside the cabinet shapes. You see the room shape from above.
- ELEVATION: You look at the FRONT of cabinets. You see cabinet doors/drawers as tall rectangles. Dimension lines show heights (e.g. 32 7/8", 65 3/4"). Base cabinets sit on the bottom, wall cabinets hang at the top.

TASK 1 — DETECT UNIT TYPE NAME (ALL PAGE TYPES):
- Look for the UNIT TYPE NAME in the title block, header, sheet title, or prominent labels on EVERY page.
- The unit type name is typically found in the title block at the bottom or side of the page, or in a header/label.
- Common formats: "TYPE 1 - AS", "TYPE 1 - MIRROR", "TYPE 2 - ADA", "TYPE 3 - AS", "TYPE 5 - MIRROR", "Studio", "1 Bed", "1B-Mirror", etc.
- This identifies WHICH unit type this drawing page belongs to.
- ALWAYS try to detect this, even on plan view and elevation pages — it's usually in the title block.
- Return null ONLY if you truly cannot find any unit type identifier on the page.

TASK 2 — EXTRACT CABINET SKUs (PLAN VIEW PAGES ONLY):
For each cabinet SKU label on the plan view, extract:
1. SKU exactly as written (e.g. B24, W3036, T84, VB30, BF3, WF6X30, FIL3, TKRUN96, CM8, LS36-L, DB15, B09FH, BLW36/3930-L)
2. Cabinet type by prefix:
   BASE      → B DB SB CB EB LS LSB (but NOT BLW/BRW — those are Wall)
   WALL      → W UB WC OH BLW BRW (BLW = Blind Left Wall, BRW = Blind Right Wall)
   TALL      → T UT TC PT PTC UC
   VANITY    → V VB VD
   ACCESSORY → FIL BF WF BFFIL WFFIL TK TKRUN CM LR EP FP DWR
3. Room — from room labels on the plan (Kitchen, Bath, Laundry, Pantry → capitalize first letter only)

COUNTING — CRITICAL:
- Count EVERY separate SKU label occurrence on the plan view page.
- If "DB15" label appears in TWO different spots → quantity 2.
- If "BF3" label appears once → quantity 1. Do NOT skip small accessories.
- ACCESSORIES MATTER: BF3, BF6, WF3X30, WF6X30, DWR3, DWR6 — count EVERY single occurrence. These small labels are easy to miss — scan the ENTIRE plan carefully including corners, edges, and between cabinets.
- FILLER-HEAD BASE CABINETS: B09FH, B06FH, B12FH — these are VERY NARROW rectangles on the plan, often only 6"-12" wide. They appear as thin slivers between larger cabinets or at the end of a run. Their labels are small and easy to overlook. ACTIVELY LOOK FOR THESE — they are commonly missed.
- Corner cabinets (LS, LSB) sit at the corner where two walls meet — count only ONCE even if the label appears at the junction of two wall runs.
- Look for "xN" or "(2)" multiplier notation.
${textLayerSkus.length > 0 ? `\nIMPORTANT - TEXT LAYER CROSS-REFERENCE:\nThe PDF text layer contains these SKUs: ${textLayerSkus.join(', ')}\nMake sure ALL of these appear in your extraction if they are visible as labels on the plan view. If a SKU from this list is missing from your results, look harder for it.\n` : ''}

STACKED / ADJACENT LABELS — ABSOLUTELY CRITICAL (MOST COMMON ERROR):
- On plan views, TWO or MORE SKU labels may appear STACKED VERTICALLY or placed very close together near the SAME cabinet location. These are ALWAYS SEPARATE cabinets, NEVER one combined SKU.
- Example: "W1230" on one line and "VDC2430" below it → TWO separate cabinets: W1230 (qty 1) AND VDC2430 (qty 1). Do NOT return "W1230VDC2430".
- Example: "W1530" near "BLW24/2730-R" → TWO separate cabinets: W1530 (qty 1) AND BLW24/2730-R (qty 1). Do NOT return "W1530-BLW24/2730-R".
- Example: "W3018B" appearing twice on the page → ONE entry with quantity 2.
- NEVER concatenate or merge adjacent labels into a single SKU string. Each distinct text label is its OWN entry.
- If you see a long SKU string that contains TWO recognizable prefixes (like "W1530BLW24"), SPLIT them into separate items.

ELEVATION PAGE DETECTION — VERY IMPORTANT:
- If you see cabinet DOORS and DRAWERS as tall rectangles with DIMENSION LINES showing heights (e.g. 32 7/8", 65 3/4"), this is an ELEVATION page.
- Elevation pages show the SAME cabinets already on the plan view. Extracting from both causes DOUBLE-COUNTING.
- When in doubt whether a page is plan view or elevation, return EMPTY items: {"unitTypeName":"<detected type>","items":[]}

RULES:
- Valid SKU: starts with a LETTER, contains at least one NUMBER (e.g. B24, BF3, DB15, W3036, B09FH)
- SKIP appliances: REF REFRIG DW DISHWASHER RANGE HOOD MICRO OTR OVEN
- SKIP non-SKU text: unit numbers, unit type names, elevation titles, dimension text, page numbers, sheet references, call-out bubbles
- Read labels EXACTLY as printed — do not invent or guess
- If NO SKUs found → return {"unitTypeName":"<detected type or null>","items":[]}
- FINAL SWEEP: After your initial scan, go back and specifically look for these commonly missed SKUs: B09FH, B06FH, B12FH, BF3, BF6, WF3X30, WF6X30, DWR3, DWR6. They appear as very small labels on narrow cabinet shapes. If you find any you missed, add them.
${unitType ? `- Unit type context: ${unitType}` : ""}

Return ONLY valid JSON — no markdown, no explanation:
{"unitTypeName":"A1-AS","items":[{"sku":"B24","type":"Base","room":"Kitchen","quantity":1},{"sku":"DB15","type":"Base","room":"Kitchen","quantity":2},{"sku":"BF3","type":"Accessory","room":"Kitchen","quantity":1},{"sku":"B09FH","type":"Base","room":"Kitchen","quantity":1}]}`;

    let content = "";
    try {
      content = await callGemini(GEMINI_API_KEY, "gemini-2.5-pro", pageImage, prompt, 0.1, 8192);
    } catch (e: any) {
      if (e.message === "rate_limit") return new Response(JSON.stringify({ error: "rate_limit" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (e.message === "credits") return new Response(JSON.stringify({ error: "credits" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ error: e.message, items: [] }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    console.log("AI Pass 1 raw:", content.slice(0, 800));

    let parsed: { items: any[]; unitTypeName?: string | null } = { items: [] };
    try { parsed = extractJson(content); } catch { console.error("Pass 1 JSON parse failed:", content.slice(0, 500)); }

    const detectedUnitType = parsed.unitTypeName ?? null;
    const pass1Raw = parsed.items ?? [];
    // Split any merged/concatenated SKUs from Pass 1
    const pass1Items = splitMergedSkus(pass1Raw);
    console.log(`Pass 1: ${pass1Raw.length} raw → ${pass1Items.length} after split, unitType: ${detectedUnitType}`);

    // Extract text layer occurrence counts for qty enforcement
    const textSkuCounts = extractSkuCounts(pageText ?? "");
    if (textSkuCounts.size > 0) {
      console.log(`Text layer counts: ${[...textSkuCounts.entries()].map(([k,v]) => `${k}:${v}`).join(', ')}`);
    }

    // ── PASS 2: Verification with gemini-2.5-flash (SKIP in fast mode) ──
    let finalItems = pass1Items;
    if (pass1Items.length > 0 && !isFastMode) {
      const verifyPrompt = `You are an expert millwork estimator doing a SECOND verification pass on a 2020 Design shop drawing PLAN VIEW page.

Pass 1 found these cabinet SKUs:
${JSON.stringify(pass1Items)}
${textLayerSkus.length > 0 ? `\nThe PDF text layer contains these SKUs with occurrence counts: ${[...textSkuCounts.entries()].map(([k,v]) => `${k} (×${v})`).join(', ')}\nIf a SKU appears multiple times in text, its quantity should be AT LEAST that count.\n` : ''}
Your job: Look at the SAME image again VERY carefully and check for:
1. MISSED SKUs — especially BF3, BF6, WF3X30, WF6X30, FIL3, DWR3, DWR6.
2. WRONG quantities — match actual label occurrences on the page.
3. MERGED LABELS — if any SKU looks like two labels combined (e.g. "W1530-BLW24/2730-R" is actually "W1530" + "BLW24/2730-R"), split them into SEPARATE entries.
4. STACKED LABELS: "W1230" above "VDC2430" = TWO separate cabinets. NEVER merge into one string.

Return the COMPLETE corrected list as JSON — no markdown:
{"items":[{"sku":"B24","type":"Base","room":"Kitchen","quantity":1}]}`;

      try {
        const verifyContent = await callGemini(GEMINI_API_KEY, "gemini-2.5-flash", pageImage, verifyPrompt, 0.1, 8192);
        console.log("Pass 2 verify:", verifyContent.slice(0, 800));
        try {
          const verifyParsed = extractJson(verifyContent);
          const pass2Raw = verifyParsed.items ?? [];
          const pass2Items = splitMergedSkus(pass2Raw);
          if (pass2Items.length > 0) {
            const mergedByKey = new Map<string, any>();
            for (const item of pass1Items) {
              const sku = String(item?.sku ?? '').toUpperCase().trim().replace(/\s*-\s*/g, '-').replace(/\s+/g, '');
              const room = String(item?.room ?? 'Kitchen').trim();
              if (!sku) continue;
              mergedByKey.set(`${sku}|${room}`, item);
            }
            for (const item of pass2Items) {
              const sku = String(item?.sku ?? '').toUpperCase().trim().replace(/\s*-\s*/g, '-').replace(/\s+/g, '');
              const room = String(item?.room ?? 'Kitchen').trim();
              if (!sku) continue;
              const key = `${sku}|${room}`;
              const existing = mergedByKey.get(key);
              if (!existing) {
                mergedByKey.set(key, item);
                continue;
              }
              mergedByKey.set(key, {
                ...existing,
                ...item,
                quantity: Math.max(Number(existing.quantity) || 1, Number(item.quantity) || 1),
              });
            }
            finalItems = Array.from(mergedByKey.values());
            console.log(`Pass 2 merge: pass1=${pass1Items.length}, pass2=${pass2Items.length}, final=${finalItems.length}`);
          }
        } catch {
          console.error("Pass 2 JSON parse failed, using Pass 1");
        }
      } catch (e) {
        console.log("Pass 2 error, using Pass 1:", e);
      }
    } else if (isFastMode) {
      console.log("Fast mode: skipping Pass 2 verification");
    }

    // ── PASS 3: Text-layer cross-reference — add missing SKUs AND enforce minimum quantities ──
    const existingSkus = new Set(finalItems.map((i: any) => String(i?.sku ?? '').toUpperCase().trim().replace(/\s*-\s*/g, '-').replace(/\s+/g, '')));
    // Also track base SKUs (without -L/-R suffix) to prevent adding variants as duplicates
    const existingBaseSkus = new Set([...existingSkus].map(getBaseSku));
    const textOnlySkus = textLayerSkus.filter(s => {
      if (existingSkus.has(s)) return false;
      // If a base variant already exists (e.g. B09FH found, skip B09FH-L from text)
      if (existingBaseSkus.has(getBaseSku(s))) {
        console.log(`Text cross-ref: skipping "${s}" — base variant "${getBaseSku(s)}" already exists`);
        return false;
      }
      return true;
    });

    if (textOnlySkus.length > 0 && finalItems.length > 0) {
      console.log(`Text cross-ref: ${textOnlySkus.length} SKUs in text but missing from AI: ${textOnlySkus.join(', ')}`);
      for (const sku of textOnlySkus) {
        const type = classifySku(sku);
        const textQty = textSkuCounts.get(sku) || 1;
        finalItems.push({ sku, type, room: "Kitchen", quantity: textQty });
        console.log(`Text cross-ref added: ${sku} (${type}) qty ${textQty}`);
      }
    }

    // ── Accessory quantity boost from text layer ──
    // For small accessory SKUs (BF, WF, DWR), the AI vision often undercounts.
    // Use text layer occurrence count as minimum qty when it's higher than AI qty.
    // Safe for accessories since they rarely appear in legends/title blocks.
    for (const item of finalItems) {
      const sku = String(item?.sku ?? '').toUpperCase().trim().replace(/\s*-\s*/g, '-').replace(/\s+/g, '');
      if (/^(BF|WF|DWR)\d/i.test(sku)) {
        const textQty = textSkuCounts.get(sku) || 0;
        if (textQty > Number(item.quantity)) {
          console.log(`Accessory qty boost: ${sku} AI=${item.quantity} → text=${textQty}`);
          item.quantity = textQty;
        }
      }
    }

    // ── PASS 4: Targeted hunt for commonly missed SKUs (SKIP in fast mode) ──
    const updatedExistingSkus = new Set(finalItems.map((i: any) => String(i?.sku ?? '').toUpperCase().trim()));
    const updatedExistingBaseSkus = new Set([...updatedExistingSkus].map(getBaseSku));
    const COMMONLY_MISSED = ['B09FH','B06FH','B12FH','BF3','BF6','WF3X30','WF6X30','FIL3','DWR3','DWR6','CM8','TK','TKRUN','EP','LR','SCRIBE','BP'];
    const missingCandidates = COMMONLY_MISSED.filter(s => !updatedExistingSkus.has(s) && !updatedExistingBaseSkus.has(getBaseSku(s)));

    if (missingCandidates.length > 0 && finalItems.length > 0 && !isFastMode) {
      console.log(`Pass 4 hunting for: ${missingCandidates.join(', ')}`);
      const pass4Prompt = `You are an expert millwork estimator doing a FINAL careful check on a 2020 Design shop drawing PLAN VIEW page.

Previous passes found these SKUs: ${[...updatedExistingSkus].join(', ')}

TASK: Look at this plan view image ONE MORE TIME. Focus ONLY on finding these SPECIFIC SKUs that may have been MISSED:
${missingCandidates.join(', ')}

These are typically:
- B09FH, B06FH, B12FH = Very NARROW filler-head base cabinets (6"-12" wide), shown as thin slivers
- BF3, BF6 = Base fillers — tiny narrow strips between cabinets. Count EVERY occurrence — if you see BF3 in 4 different spots, quantity = 4.
- WF3X30, WF6X30 = Wall fillers — small strips near wall cabinets
- FIL3, DWR3, DWR6, CM8, TK, TKRUN, EP, LR = Small accessories

If this is an ELEVATION page, return {"items":[]}.
Only report SKUs you can ACTUALLY SEE — do not guess.
Report the CORRECT QUANTITY for each (count every occurrence on the page).

Return ONLY NEWLY FOUND items as JSON — no markdown:
{"items":[{"sku":"BF3","type":"Accessory","room":"Kitchen","quantity":4}]}
If none found, return {"items":[]}`;

      try {
        const pass4Content = await callGemini(GEMINI_API_KEY, "gemini-2.5-flash", pageImage, pass4Prompt, 0.2, 4096);
        console.log("Pass 4 targeted:", pass4Content.slice(0, 500));
        try {
          const pass4Parsed = extractJson(pass4Content);
          const pass4Items = pass4Parsed.items ?? [];
          for (const item of pass4Items) {
            const sku = String(item?.sku ?? '').toUpperCase().trim().replace(/\s*-\s*/g, '-').replace(/\s+/g, '');
            const room = String(item?.room ?? 'Kitchen').trim();
            if (!sku) continue;
            const key = `${sku}|${room}`;
            const alreadyExists = finalItems.some((e: any) => {
              const eSku = String(e?.sku ?? '').toUpperCase().trim();
              const eBase = getBaseSku(eSku);
              const newBase = getBaseSku(sku);
              const eRoom = String(e?.room ?? 'Kitchen').trim();
              return (eBase === newBase) && eRoom === room;
            });
            if (!alreadyExists) {
              finalItems.push(item);
              console.log(`Pass 4 found: ${sku} (${room}) qty ${item.quantity}`);
            }
          }
        } catch {
          console.error("Pass 4 JSON parse failed");
        }
      } catch (e) {
        console.log("Pass 4 error:", e);
      }
    } else if (isFastMode) {
      console.log("Fast mode: skipping Pass 4 targeted hunt");
    }

    console.log(`Final: ${finalItems.length} items`);

    // ── Normalize and filter ──
    const NO_DIGIT_OK = /^(BP|SCRIBE)$/i;
    const items = (finalItems)
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
        return true;
      })
      .map((c: any) => {
        const sku = String(c.sku).toUpperCase().trim().replace(/\s*-\s*/g, '-').replace(/\s+/g, '');
        let rawType = String(c.type ?? "Base").trim();
        if (/^BLW|^BRW/i.test(sku)) rawType = "Wall";
        const normalizedType = rawType.charAt(0).toUpperCase() + rawType.slice(1).toLowerCase();
        const rawRoom = String(c.room ?? "Kitchen").trim();
        const normalizedRoom = rawRoom.charAt(0).toUpperCase() + rawRoom.slice(1).toLowerCase();
        return { sku, type: normalizedType, room: normalizedRoom, quantity: Number(c.quantity) || 1 };
      });

    // Deduplicate — merge -L/-R variants into base SKU (handedness is install-time, not part identity)
    const isCornerLazySusan = (sku: string) => /^(LS|LSB)\d+/i.test(sku);
    const deduped = new Map<string, { sku: string; type: string; room: string; quantity: number }>();
    for (const item of items) {
      const baseSku = getBaseSku(item.sku);
      const key = `${baseSku}|${item.room}`;
      const existing = deduped.get(key);
      if (existing) {
        existing.quantity = isCornerLazySusan(baseSku)
          ? Math.max(existing.quantity, item.quantity)
          : existing.quantity + item.quantity;
      } else {
        deduped.set(key, { ...item, sku: baseSku });
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
