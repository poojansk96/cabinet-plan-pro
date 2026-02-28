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

These are 2020 Design software shop drawings. They contain THREE types of pages:

PAGE TYPES:
  A) TITLE PAGE / COVER PAGE — contains project info, unit type name, unit numbers. No cabinet drawings.
  B) PLAN VIEW PAGE (top-down view) — shows cabinets from ABOVE as rectangular outlines with SKU labels written on or next to each cabinet. Walls appear as thick lines. You see the room layout from a bird's-eye perspective. Cabinet SKU labels like "B24", "W3030B", "DB15", "BF3" are placed directly on/near the cabinet shapes.
  C) ELEVATION PAGE (front/side view) — shows cabinets as you would see them standing in front of them. Rectangular boxes stacked vertically (base on bottom, wall on top). Has dimension lines showing heights.

WHAT TO DO FOR EACH PAGE TYPE:
- TITLE PAGE → return {"unitTypeName":"<detected type>","items":[]}
- PLAN VIEW PAGE → EXTRACT all cabinet SKU labels (this is the main source of data)
- ELEVATION PAGE → DO NOT extract. Return {"unitTypeName":null,"items":[]}
  *** Elevation pages show the SAME cabinets already visible on plan view pages. Extracting from both would cause double-counting. Only extract from PLAN VIEW pages. ***

HOW TO TELL PLAN VIEW vs ELEVATION:
- PLAN VIEW: You look DOWN at the room. Cabinets are flat rectangular outlines along walls. Labels are placed inside or beside the cabinet shapes. You see the room shape from above.
- ELEVATION: You look at the FRONT of cabinets. You see cabinet doors/drawers as tall rectangles. Dimension lines show heights (e.g. 32 7/8", 65 3/4"). Base cabinets sit on the bottom, wall cabinets hang at the top.

TASK 1 — DETECT UNIT TYPE NAME (TITLE PAGE ONLY):
- Look for the UNIT TYPE NAME in the title block, header, or prominent labels.
- Typically: "A1", "A1-As", "A2", "B1", "TYPE A - AS", "Studio", etc.
- Return: {"unitTypeName":"A1-As","items":[]}

TASK 2 — EXTRACT CABINET SKUs (PLAN VIEW PAGES ONLY):
For each cabinet SKU label on the plan view, extract:
1. SKU exactly as written (e.g. B24, W3036, T84, VB30, BF3, WF6X30, FIL3, TKRUN96, CM8, LS36-L, DB15)
2. Cabinet type by prefix:
   BASE      → B DB SB CB EB LS LSB
   WALL      → W UB WC OH
   TALL      → T UT TC PT PTC UC
   VANITY    → V VB VD
   ACCESSORY → FIL BF WF BFFIL WFFIL TK TKRUN CM LR EP FP
3. Room — from room labels on the plan (Kitchen, Bath, Laundry, Pantry → capitalize first letter only)

COUNTING — CRITICAL:
- Count EVERY separate SKU label occurrence on the plan view page.
- If "DB15" label appears in TWO different spots → quantity 2.
- If "BF3" label appears once → quantity 1. Do NOT skip small accessories.
- ACCESSORIES MATTER: BF3, BF6, WF3X30, WF6X30 — count every occurrence.
- Corner cabinets (LS, LSB) sit at the corner where two walls meet — count only ONCE even if the label appears at the junction of two wall runs.
- Look for "xN" or "(2)" multiplier notation.

RULES:
- Valid SKU: starts with a LETTER, contains at least one NUMBER (e.g. B24, BF3, DB15, W3036)
- SKIP appliances: REF REFRIG DW DISHWASHER RANGE HOOD MICRO OTR OVEN
- SKIP non-SKU text: unit numbers, unit type names, elevation titles, dimension text, page numbers, sheet references, call-out bubbles
- Read labels EXACTLY as printed — do not invent or guess
- If NO SKUs found → return {"unitTypeName":null,"items":[]}
${unitType ? `- Unit type context: ${unitType}` : ""}

Return ONLY valid JSON — no markdown, no explanation:
{"unitTypeName":"A1","items":[{"sku":"B24","type":"Base","room":"Kitchen","quantity":1},{"sku":"DB15","type":"Base","room":"Kitchen","quantity":2},{"sku":"BF3","type":"Accessory","room":"Kitchen","quantity":1}]}`;

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
    // Corner Lazy Susan SKUs (LS/LSB) appear on two adjacent elevations for one cabinet — use max.
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
