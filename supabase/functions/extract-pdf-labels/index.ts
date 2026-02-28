import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {

  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not configured");

    const { pageImage, unitType } = await req.json();

    if (!pageImage || typeof pageImage !== "string") {
      return new Response(JSON.stringify({ error: "pageImage (base64 string) required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const prompt = `You are an expert millwork estimator reading a 2020 Design shop drawing page.

FIRST — DETERMINE THE PAGE TYPE:
Carefully examine this image and classify it as ONE of these types:
  A) TITLE PAGE / COVER PAGE — contains project info, unit type name, unit numbers, no cabinet drawings
  B) FLOOR PLAN — a TOP-DOWN / PLAN VIEW showing room layout from above (walls, doors, appliances shown as outlines from above). You can tell it's a floor plan because you see the room layout from a bird's-eye view.
  C) ELEVATION DRAWING — a FRONT VIEW / SIDE VIEW showing cabinet boxes drawn as rectangles stacked vertically (base cabinets on bottom, wall cabinets on top). Elevation drawings show cabinets as you would see them standing in front of them.

CRITICAL RULES FOR PAGE TYPE:
- If this page is a TITLE PAGE or COVER PAGE → return {"unitTypeName":"<detected type>","items":[]}
- If this page is a FLOOR PLAN (top-down view) → return {"unitTypeName":null,"items":[]}
  *** DO NOT extract ANY cabinet SKUs from floor plans. Floor plans show rooms from above — they are NOT elevation drawings. Even if you can read SKU labels on a floor plan, DO NOT extract them. Return an EMPTY items array. ***
- If this page is an ELEVATION DRAWING (front view) → extract cabinets as described below.

TASK 1 — DETECT UNIT TYPE NAME (TITLE PAGE / COVER PAGE ONLY):
If this is a TITLE PAGE or COVER PAGE:
- Look for the UNIT TYPE NAME in the title block, header, or prominent labels.
- This is typically something like "A1", "A1-As", "A2", "B1", "2BHK", "1BR", "Type A", "Studio", etc.
- Return the EXACT unit type name as written on the drawing.
- Return: {"unitTypeName":"A1-As","items":[]}

TASK 2 — EXTRACT CABINETS (ELEVATION DRAWINGS ONLY — NOT FROM FLOOR PLANS):
Only extract cabinets if this page shows ELEVATION drawings (front/side views of cabinets).

For each cabinet item extract:
1. SKU / model label exactly as written (e.g. B24, W3036, T84, VB30, BF3, WF330, FIL3, TKRUN96, CM8, etc.)
2. Cabinet type determined by label prefix:
   BASE      → prefixes B DB SB CB EB
   WALL      → prefixes W UB WC OH
   TALL      → prefixes T UT TC PT PTC UC
   VANITY    → prefixes V VB VD
   ACCESSORY → fillers (FIL BF WF BFFIL WFFIL), toe kick (TK TKRUN), crown (CM), light rail (LR), end panels (EP FP), hardware
3. Room from elevation title text (KITCHEN, BATH, LAUNDRY, PANTRY → capitalize first letter only)

COUNTING METHOD — THIS IS THE MOST CRITICAL STEP:
Before producing the final JSON, perform a careful visual scan of the elevation drawing:

Step A: Scan the elevation from LEFT to RIGHT. For EVERY distinct rectangular cabinet box you see drawn, note:
  - Its approximate horizontal position
  - The SKU label it belongs to (follow leader lines / callout lines from labels to boxes)
  - Count the number of physically SEPARATE cabinet boxes that belong to each label

Step B: Count each SKU ACCURATELY — THIS IS WHERE MOST ERRORS HAPPEN:
  - Count the actual number of SEPARATE rectangular cabinet boxes drawn for each SKU label.
  - CRITICAL W3030 EXAMPLE: Look at the image very carefully. If you see a SKU label like "W3030B" and there are TWO adjacent rectangular boxes of equal width drawn side by side near that label, the quantity MUST be 2, NOT 1. This is the #1 most common error. Count the VERTICAL DIVIDING LINES between boxes.
  - In 2020 Design shop drawings, identical cabinets placed side by side are drawn as adjacent rectangles with a clear vertical line separating them. Each rectangle = 1 cabinet.
  - Look for "xN" or "(2)" multiplier notation near labels.
  - DOUBLE CHECK all W-prefixed wall cabinets (W3030, W2730, W3324, etc.) — they frequently appear as 2+ adjacent identical boxes under ONE label. Count each box.

Step C: CORNER CABINETS (LS, LSB, LAZY SUSAN) — CRITICAL:
  - Lazy Susan corner cabinets (LS36, LS33, LSB36, etc.) sit at the corner where two walls meet.
  - The SAME LS cabinet will appear on TWO adjacent elevation views on the same page — once on each wall.
  - COUNT LAZY SUSAN / LS CABINETS ONLY ONCE per page, even if visible on two elevations.
  - If "LS36-L" appears on elevation A AND elevation B on the same page, quantity is still 1.

Step D: For ACCESSORIES (fillers WF, BF, WFFIL, BFFIL; toe kick TK/TKRUN; crown CM; light rail LR; end panels EP/FP): Count the EXACT number of label occurrences on THIS elevation only. If "WF6X30" appears on the LEFT and RIGHT sides, that is quantity 2. Do NOT inflate.

Step E: Group by SKU + room and count the total distinct physical boxes for the quantity field.

RULES:
- *** ABSOLUTELY DO NOT extract cabinet SKUs from FLOOR PLANS — only from ELEVATION drawings ***
- A valid cabinet SKU must start with a LETTER and contain at least one NUMBER (e.g. B24, W3036, T84, VB30, FIL3)
- SKIP appliances: REF REFRIG DW DISHWASHER RANGE HOOD MICRO OTR OVEN
- SKIP these NON-SKU items:
  * Unit numbers (e.g. "Unit 101", "101", "201")
  * Unit type names (e.g. "A1-As", "Type A", "2BHK")
  * Call-out addresses or bubble references (e.g. "A1", "1A", "A", circled numbers)
  * Elevation titles (e.g. "ELEVATION A", "WALL A")
  * Floor labels, building names, drawing titles, notes
  * Dimension text (e.g. "24"", "36 1/2"")
  * Page numbers or sheet references
- Read labels EXACTLY as printed — do not invent or guess SKUs
- If NO cabinet SKUs are readable on this page, return {"unitTypeName":null,"items":[]}
${unitType ? `- Unit type context: ${unitType}` : ""}

Return ONLY valid JSON — no markdown, no explanation, no reasoning text:
{"unitTypeName":"A1","items":[{"sku":"B24","type":"Base","room":"Kitchen","quantity":1},{"sku":"W3036","type":"Wall","room":"Kitchen","quantity":2}]}`;

    let response: Response | null = null;
    const MAX_RETRIES = 3;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ role: "user", parts: [
                { inlineData: { mimeType: "image/jpeg", data: pageImage } },
                { text: prompt },
              ]}],
              generationConfig: { temperature: 0.1, maxOutputTokens: 4096 },
            }),
          }
        );
      } catch (fetchErr) {
        console.error(`AI fetch error (attempt ${attempt + 1}):`, fetchErr);
        if (attempt < MAX_RETRIES - 1) { await new Promise(r => setTimeout(r, 2000 * (attempt + 1))); continue; }
        throw fetchErr;
      }

      if (response.status === 503 || response.status === 500) {
        const errText = await response.text();
        console.warn(`AI unavailable (${response.status}), attempt ${attempt + 1}/${MAX_RETRIES}:`, errText.slice(0, 200));
        response = null;
        if (attempt < MAX_RETRIES - 1) { await new Promise(r => setTimeout(r, 3000 * (attempt + 1))); continue; }
        return new Response(JSON.stringify({ error: "AI model temporarily unavailable. Please try again in a moment.", items: [] }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      break;
    }

    if (!response) {
      return new Response(JSON.stringify({ error: "AI model temporarily unavailable. Please try again in a moment.", items: [] }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (!response.ok) {
      const errText = await response.text();
      console.error("AI gateway error:", response.status, errText);
      if (response.status === 429) return new Response(JSON.stringify({ error: "rate_limit" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (response.status === 402) return new Response(JSON.stringify({ error: "credits" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ error: `AI error: ${response.status}`, items: [] }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const aiData = await response.json();
    const content: string = aiData.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    console.log("AI Pass 1 raw:", content.slice(0, 800));

    function extractJson(raw: string): any {
      let cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
      const lastBrace = cleaned.lastIndexOf('}');
      if (lastBrace !== -1) {
        let depth = 0, startIdx = -1;
        for (let i = lastBrace; i >= 0; i--) {
          if (cleaned[i] === '}') depth++;
          else if (cleaned[i] === '{') { depth--; if (depth === 0) { startIdx = i; break; } }
        }
        if (startIdx !== -1) cleaned = cleaned.substring(startIdx, lastBrace + 1);
      }
      return JSON.parse(cleaned);
    }

    let parsed: { items: any[]; unitTypeName?: string | null } = { items: [] };
    try { parsed = extractJson(content); } catch { console.error("Pass 1 JSON parse failed:", content.slice(0, 500)); }

    const detectedUnitType = parsed.unitTypeName ?? null;
    const pass1Items = parsed.items ?? [];

    const rawItems = pass1Items;
    console.log(`Extracted ${rawItems.length} items`);

    // Filter: must start with letter AND contain a number (real SKU, not labels/titles)
    // Appliance prefixes to reject
    const APPLIANCE_RE = /^(REF|REFRIG|REFRIGERATOR|DW(?!R)|DDW|DISHWASHER|DISHW|RANGE|HOOD|MICRO|OTR|OVEN|COOK|STOVE|MW|WM|WASHER|DRYER|FREEZER|WINE|ICE|TRASH|COMPACT|SINK|FAN|VENT|DISP)/i;

    const items = (rawItems)
      .filter((c: any) => c.sku && /^[A-Za-z]/.test(c.sku) && /\d/.test(c.sku))
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
        const rawType = String(c.type ?? "Base").trim();
        const normalizedType = rawType.charAt(0).toUpperCase() + rawType.slice(1).toLowerCase();
        const rawRoom = String(c.room ?? "Kitchen").trim();
        const normalizedRoom = rawRoom.charAt(0).toUpperCase() + rawRoom.slice(1).toLowerCase();
        return {
          sku: String(c.sku).toUpperCase().trim().replace(/\s*-\s*/g, '-').replace(/\s+/g, ''),
          type: normalizedType,
          room: normalizedRoom,
          quantity: Number(c.quantity) || 1,
        };
      });

    // Deduplicate by SKU+room.
    // Normal SKUs are summed when repeated on the same page.
    // Corner Lazy Susan SKUs (LS/LSB) can appear on two adjacent elevations
    // for the same physical corner cabinet, so keep max instead of sum.
    const isCornerLazySusan = (sku: string) => /^(LS|LSB)\d+/i.test(sku);

    const deduped = new Map<string, { sku: string; type: string; room: string; quantity: number }>();
    for (const item of items) {
      const key = `${item.sku}|${item.room}`;
      const existing = deduped.get(key);
      if (existing) {
        existing.quantity = isCornerLazySusan(item.sku)
          ? Math.max(existing.quantity, item.quantity)
          : existing.quantity + item.quantity;
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
