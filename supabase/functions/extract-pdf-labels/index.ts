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

TASK: Extract every cabinet label and accessory label visible on this page.

For each item extract:
1. SKU / model label exactly as written (e.g. B24, W3036, T84, FIL3, TKRUN96, CM8, etc.)
2. Cabinet type determined by label prefix and vertical position:
   BASE    → prefixes B DB SB CB EB or lower row  → default H=34.5, D=24
   WALL    → prefixes W UB WC UC OH or upper row   → default H=30, D=12
   TALL    → prefixes T UT TC PT PTC              → default H=84, D=24
   VANITY  → prefixes V VB VD                     → default H=34.5, D=21
   ACCESSORY → fillers (FIL), toe kick (TK TKRUN), crown (CM), light rail (LR), panels (FP EP), hardware, etc.
3. Room from elevation title (KITCHEN, BATH, LAUNDRY, PANTRY → capitalize first letter only → Kitchen, Bath etc.)
4. Quantity — count each distinct label occurrence; same SKU in same room summed
5. For accessories: set type = "Accessory", record label in sku field exactly

RULES:
- Read labels EXACTLY as printed — do not invent or guess SKUs
- SKIP appliances: REF REFRIG DW DISHWASHER RANGE HOOD MICRO OTR OVEN
- A valid SKU must start with a LETTER
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

    const items = (parsed.items ?? [])
      .filter((c: any) => c.sku && /^[A-Za-z]/.test(c.sku))
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
