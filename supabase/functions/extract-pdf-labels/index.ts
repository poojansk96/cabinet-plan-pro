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
  C) ELEVATION DRAWING — a FRONT VIEW / SIDE VIEW showing cabinet boxes drawn as rectangles stacked vertically (base cabinets on bottom, wall cabinets on top).

CRITICAL RULES FOR PAGE TYPE:
- If this page is a TITLE PAGE or COVER PAGE → return {"unitTypeName":"<detected type>","items":[]}
- If this page is an ELEVATION DRAWING (front view) → return {"unitTypeName":null,"items":[]}
  *** DO NOT extract ANY cabinet SKUs from elevation drawings. Skip them entirely. Return an EMPTY items array. ***
- If this page is a FLOOR PLAN (top-down view) → extract cabinet SKUs as described below.

TASK 1 — DETECT UNIT TYPE NAME (TITLE PAGE / COVER PAGE ONLY):
If this is a TITLE PAGE or COVER PAGE:
- Look for the UNIT TYPE NAME in the title block, header, or prominent labels.
- This is typically something like "A1", "A1-As", "A2", "B1", "2BHK", "1BR", "Type A", "Studio", etc.
- Return the EXACT unit type name as written on the drawing.
- Return: {"unitTypeName":"A1-As","items":[]}

TASK 2 — EXTRACT CABINETS (FLOOR PLANS ONLY — NOT FROM ELEVATIONS):
Only extract cabinets if this page shows a FLOOR PLAN (top-down / plan view).

On floor plans, cabinet SKUs are written as text labels placed on or next to the cabinet outlines in the plan view. Each label represents ONE cabinet unless a multiplier like "x2" or "(2)" is shown next to it.

For each cabinet SKU label visible on the floor plan, extract:
1. SKU / model label exactly as written (e.g. B24, W3036, T84, VB30, BF3, WF330, FIL3, TKRUN96, CM8, LS36-L, etc.)
2. Cabinet type determined by label prefix:
   BASE      → prefixes B DB SB CB EB LS LSB
   WALL      → prefixes W UB WC OH
   TALL      → prefixes T UT TC PT PTC UC
   VANITY    → prefixes V VB VD
   ACCESSORY → fillers (FIL BF WF BFFIL WFFIL), toe kick (TK TKRUN), crown (CM), light rail (LR), end panels (EP FP), hardware
3. Room — determine from the room label on the floor plan where the cabinet is located (KITCHEN, BATH, LAUNDRY, PANTRY, ISLAND → capitalize first letter only)

COUNTING METHOD:
- Scan the floor plan carefully and read EVERY cabinet SKU label you see.
- Each separate text label = 1 cabinet, unless a multiplier notation is present.
- If the same SKU label appears multiple times in different locations on the plan, count each occurrence.
- Corner cabinets (LS, LSB) appear ONCE on the floor plan at the corner — count them as quantity 1.

RULES:
- *** ABSOLUTELY DO NOT extract cabinet SKUs from ELEVATION drawings — only from FLOOR PLANS ***
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

    // Deduplicate by SKU+room — SUM quantities
    const deduped = new Map<string, { sku: string; type: string; room: string; quantity: number }>();
    for (const item of items) {
      const key = `${item.sku}|${item.room}`;
      const existing = deduped.get(key);
      if (existing) {
        existing.quantity += item.quantity;
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
