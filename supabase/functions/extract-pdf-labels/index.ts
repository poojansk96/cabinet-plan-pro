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
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const useDirectGemini = !!GEMINI_API_KEY;
    if (!GEMINI_API_KEY && !LOVABLE_API_KEY) throw new Error("No AI API key configured");

    const { pageImage, unitType } = await req.json();

    if (!pageImage || typeof pageImage !== "string") {
      return new Response(JSON.stringify({ error: "pageImage (base64 string) required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const prompt = `You are an expert millwork estimator reading a 2020 Design shop drawing page.

This page may be a FLOOR PLAN (top-down view) or an ELEVATION drawing (front view).

IMPORTANT: If this page is a FLOOR PLAN (top-down/plan view), return {"unitTypeName":null,"items":[]} immediately. Only extract cabinets from ELEVATION drawings (front/side views showing cabinet boxes with height).

TASK 1 — DETECT UNIT TYPE NAME:
Look at the drawing's title block, header, footer, or prominent labels for the UNIT TYPE NAME.
This is typically something like "A1", "A1-As", "A2", "B1", "2BHK", "1BR", "Type A", "Studio", etc.
It usually appears in the title block or as a prominent label at the top of the drawing.
Do NOT confuse unit type with unit numbers (e.g. "101", "201") or elevation labels (e.g. "Elevation A").
If you cannot determine the unit type, return null for unitTypeName.

TASK 2 — EXTRACT CABINETS (ELEVATIONS ONLY):
For each item extract:
1. SKU / model label exactly as written (e.g. B24, W3036, T84, VB30, BF3, WF330, FIL3, TKRUN96, CM8, etc.)
2. Cabinet type determined by label prefix:
   BASE      → prefixes B DB SB CB EB
   WALL      → prefixes W UB WC OH
   TALL      → prefixes T UT TC PT PTC UC
   VANITY    → prefixes V VB VD
   ACCESSORY → fillers (FIL BF WF BFFIL WFFIL), toe kick (TK TKRUN), crown (CM), light rail (LR), end panels (EP FP), hardware
3. Room from elevation title or floor plan room label (KITCHEN, BATH, LAUNDRY, PANTRY → capitalize first letter only)

COUNTING METHOD — THIS IS THE MOST CRITICAL STEP:
You MUST carefully count every distinct cabinet box in the elevation. Do NOT just count labels — count the actual rectangular boxes drawn.

Step A: Scan the elevation from LEFT to RIGHT. For EVERY distinct rectangular cabinet box you see drawn, note:
  - Its approximate horizontal position (e.g. "far left", "left-center", "left of sink", "center", "right of range", "far right")
  - The SKU label it belongs to (follow leader lines / callout lines from labels to boxes)
  - Whether the label points to ONE box or MULTIPLE adjacent boxes of the same width

Step B: Count ACCURATELY — do not undercount:
  - A single SKU label often points to MULTIPLE adjacent identical cabinet boxes (e.g. two W3030 boxes side by side). Count each distinct rectangular box separately.
  - Look for vertical dividing lines between adjacent boxes — each rectangle separated by a vertical line is a separate cabinet, even if they share one label/callout.
  - If two or more identical-width rectangles sit next to each other under the same SKU label, the quantity equals the number of rectangles, NOT 1.
  - For ACCESSORIES (fillers WF/BF/WFFIL/BFFIL, toe kick TK/TKRUN, crown CM, light rail LR, end panels EP/FP): default to quantity 1 per label unless you clearly see multiples.
  - If a SKU label appears in MULTIPLE separate locations on the elevation, list them as SEPARATE entries — the system will merge them.

Step C: Group by SKU + room and set quantity to the total number of distinct physical boxes you counted.

RULES:
- ONLY extract from ELEVATION drawings — do NOT extract cabinet labels from floor plans
- A valid cabinet SKU must start with a LETTER and contain at least one NUMBER (e.g. B24, W3036, T84, VB30, FIL3)
- SKIP appliances: REF REFRIG DW DISHWASHER RANGE HOOD MICRO OTR OVEN
- SKIP these NON-SKU items — they are NOT cabinets:
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
        if (useDirectGemini) {
          response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${GEMINI_API_KEY}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                contents: [{ role: "user", parts: [
                  { inlineData: { mimeType: "image/jpeg", data: pageImage } },
                  { text: prompt },
                ]}],
                generationConfig: { temperature: 0.2, maxOutputTokens: 8192 },
              }),
            }
          );
        } else {
          response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "google/gemini-2.5-pro",
              messages: [{ role: "user", content: [
                { type: "image_url", image_url: { url: `data:image/jpeg;base64,${pageImage}` } },
                { type: "text", text: prompt },
              ]}],
              temperature: 0.2, max_tokens: 8192,
            }),
          });
        }
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
    const content: string = useDirectGemini
      ? (aiData.candidates?.[0]?.content?.parts?.[0]?.text ?? "")
      : (aiData.choices?.[0]?.message?.content ?? "");
    console.log("AI raw response:", content.slice(0, 800));

    let parsed: { items: any[]; unitTypeName?: string | null } = { items: [] };
    try {
      // Strip markdown fences
      let cleaned = content
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/```\s*$/i, "")
        .trim();
      
      // If the model produced chain-of-thought text before JSON, find the last JSON object
      const lastBrace = cleaned.lastIndexOf('}');
      if (lastBrace !== -1) {
        // Find the matching opening brace for the top-level JSON object
        let depth = 0;
        let startIdx = -1;
        for (let i = lastBrace; i >= 0; i--) {
          if (cleaned[i] === '}') depth++;
          else if (cleaned[i] === '{') {
            depth--;
            if (depth === 0) { startIdx = i; break; }
          }
        }
        if (startIdx !== -1) {
          cleaned = cleaned.substring(startIdx, lastBrace + 1);
        }
      }
      
      parsed = JSON.parse(cleaned);
    } catch {
      console.error("JSON parse failed:", content.slice(0, 500));
    }

    const detectedUnitType = parsed.unitTypeName ?? null;

    // Filter: must start with letter AND contain a number (real SKU, not labels/titles)
    // Appliance prefixes to reject
    const APPLIANCE_RE = /^(REF|REFRIG|REFRIGERATOR|DW(?!R)|DDW|DISHWASHER|DISHW|RANGE|HOOD|MICRO|OTR|OVEN|COOK|STOVE|MW|WM|WASHER|DRYER|FREEZER|WINE|ICE|TRASH|COMPACT|SINK|FAN|VENT|DISP)/i;

    const items = (parsed.items ?? [])
      .filter((c: any) => c.sku && /^[A-Za-z]/.test(c.sku) && /\d/.test(c.sku))
      .filter((c: any) => {
        const upper = String(c.sku).toUpperCase().trim();
        // Skip appliances
        if (APPLIANCE_RE.test(upper)) return false;
        // Skip anything that looks like a unit number, type name, or call-out address
        if (/^UNIT\b/i.test(upper)) return false;
        if (/^ELEV/i.test(upper)) return false;
        if (/^FLOOR/i.test(upper)) return false;
        if (/^TYPE\s/i.test(upper)) return false;
        if (/^WALL\s+[A-Z]$/i.test(upper)) return false; // "WALL A" title, not a cabinet
        if (/^[A-Z]\d?-[A-Z]/i.test(upper) && upper.length <= 4) return false; // call-out like "A1-B" but not cabinet SKUs like "B15-L"
        return true;
      })
      .map((c: any) => {
        // Normalize type to title case (e.g. "ACCESSORY" → "Accessory", "base" → "Base")
        const rawType = String(c.type ?? "Base").trim();
        const normalizedType = rawType.charAt(0).toUpperCase() + rawType.slice(1).toLowerCase();
        // Normalize room to title case
        const rawRoom = String(c.room ?? "Kitchen").trim();
        const normalizedRoom = rawRoom.charAt(0).toUpperCase() + rawRoom.slice(1).toLowerCase();
        return {
          // Normalize SKU: uppercase, trim, remove spaces around hyphens
          sku: String(c.sku).toUpperCase().trim().replace(/\s*-\s*/g, '-').replace(/\s+/g, ''),
          type: normalizedType,
          room: normalizedRoom,
          quantity: Number(c.quantity) || 1,
        };
      });

    // Deduplicate by SKU+room — SUM quantities since the AI may return the
    // same SKU in separate entries (e.g. from different parts of the elevation).
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
