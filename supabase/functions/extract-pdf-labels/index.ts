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
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const { pageImage, unitType } = await req.json();

    if (!pageImage || typeof pageImage !== "string") {
      return new Response(JSON.stringify({ error: "pageImage (base64 string) required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const prompt = `You are an expert millwork estimator reading a 2020 Design shop drawing / cabinet elevation sheet.

TASK: Extract ONLY base cabinets, wall cabinets, and their related accessories/fillers visible on this page.

For each item extract:
1. SKU / model label exactly as written (e.g. B24, W3036, BF3, WF330, WF3x30, BFFIL, WFFIL, FIL3, etc.)
2. Cabinet type determined by label prefix:
   BASE      → prefixes B DB SB CB EB BF
   WALL      → prefixes W UB WC UC OH WF
   ACCESSORY → fillers (FIL BF WF BFFIL WFFIL), toe kick (TK TKRUN), crown (CM), light rail (LR), end panels (EP FP)
3. Room from elevation title (KITCHEN, BATH, LAUNDRY, PANTRY → capitalize first letter only → Kitchen, Bath etc.)
4. Quantity — count each distinct label occurrence; same SKU in same room summed

RULES:
- ONLY extract Base cabinets, Wall cabinets, and their accessories (fillers, panels, moldings)
- SKIP Tall cabinets (T UT TC PT PTC prefixes) — do NOT include them
- SKIP Vanity cabinets (V VB VD prefixes) — do NOT include them
- SKIP appliances: REF REFRIG DW DISHWASHER RANGE HOOD MICRO OTR OVEN
- SKIP unit numbers, unit type names, call-out addresses, dimension text, notes, and any non-SKU text
- A valid SKU must start with a LETTER and contain at least one NUMBER (e.g. B24, W3036, BF3, FIL3)
- Do NOT extract text like "Unit 101", "A1-As", "ELEVATION A", floor labels, or drawing titles as SKUs
- Read labels EXACTLY as printed — do not invent or guess SKUs
- If this is a floor plan (top-down, no elevations), return {"items":[]}
- Do NOT measure dimensions from drawing geometry — dimensions fields are optional
${unitType ? `- Unit type context: ${unitType}` : ""}

Return ONLY valid JSON — no markdown, no explanation:
{"items":[{"sku":"B24","type":"Base","room":"Kitchen","quantity":1},{"sku":"W3036","type":"Wall","room":"Kitchen","quantity":2}]}`;

    const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${LOVABLE_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "google/gemini-2.5-flash",
        messages: [
          {
            role: "user",
            content: [
              {
                type: "image_url",
                image_url: { url: `data:image/jpeg;base64,${pageImage}` },
              },
              { type: "text", text: prompt },
            ],
          },
        ],
        temperature: 0.1,
        max_tokens: 4096,
      }),
    });

    if (!response.ok) {
      const errText = await response.text();
      console.error("AI gateway error:", response.status, errText);
      if (response.status === 429) return new Response(JSON.stringify({ error: "rate_limit" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (response.status === 402) return new Response(JSON.stringify({ error: "credits" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ error: `AI error: ${response.status}`, items: [] }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const aiData = await response.json();
    const content: string = aiData.choices?.[0]?.message?.content ?? "";
    console.log("AI raw response:", content.slice(0, 800));

    let parsed: { items: any[] } = { items: [] };
    try {
      const cleaned = content
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/```\s*$/i, "")
        .trim();
      parsed = JSON.parse(cleaned);
    } catch {
      console.error("JSON parse failed:", content.slice(0, 500));
    }

    // Filter: must start with letter AND contain a number (real SKU, not labels/titles)
    const items = (parsed.items ?? [])
      .filter((c: any) => c.sku && /^[A-Za-z]/.test(c.sku) && /\d/.test(c.sku))
      .filter((c: any) => {
        const upper = String(c.sku).toUpperCase().trim();
        // Skip anything that looks like a unit number, type name, or address
        if (/^UNIT\s/i.test(upper)) return false;
        if (/^ELEV/i.test(upper)) return false;
        if (/^FLOOR/i.test(upper)) return false;
        if (/^TYPE\s/i.test(upper)) return false;
        // Only allow Base, Wall, Accessory types
        const t = String(c.type || "").toLowerCase();
        if (t === "tall" || t === "vanity") return false;
        return true;
      })
      .map((c: any) => ({
        sku: String(c.sku).toUpperCase().trim(),
        type: c.type ?? "Base",
        room: c.room ?? "Kitchen",
        quantity: Number(c.quantity) || 1,
      }));

    return new Response(JSON.stringify({ items }), {
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
