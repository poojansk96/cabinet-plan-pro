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
    if (!LOVABLE_API_KEY) throw new Error("No AI API key configured");

    // Accepts a single page image per call — client loops pages
    const { pageImage, scaleFactor, scaleLabel, unitType } = await req.json();

    if (!pageImage || typeof pageImage !== "string") {
      return new Response(JSON.stringify({ error: "pageImage (base64 string) required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const prompt = `You are an expert millwork estimator analyzing a cabinet ELEVATION drawing image.

Drawing scale: ${scaleLabel ?? `1:${scaleFactor}`}  — 1 inch on paper = ${scaleFactor} real inches.

TASK:
Look at every cabinet box visible in this elevation drawing and extract:
1. SKU / model label (e.g. B24, W3036, T84, VB30, DB30, UB1530, etc.)
2. Width in real-world inches — read dimension labels first, then measure the box visually and multiply by ${scaleFactor}
3. Height in real-world inches — read from label or use default
4. Depth in real-world inches — use default unless labeled
5. Cabinet type from its vertical position and SKU prefix:
   BASE  → lower row, prefixes B DB SB CB EB  → default H=34.5", D=24"
   WALL  → upper/wall-hung row, prefixes W UB OH WC → default H=30", D=12"
   TALL  → floor-to-ceiling column, prefixes T UT TC PT PTC UC → default H=84", D=24"
   VANITY→ bathroom base, prefixes V VB VD → default H=34.5", D=21"
6. Room from elevation title text (KITCHEN, BATH, LAUNDRY, PANTRY → capitalize first letter only)
7. Quantity — count each unique cabinet box; if the same SKU repeats sum the quantity

RULES:
- SKIP appliances: REF REFRIG REFRIGERATOR DW DISHWASHER RANGE HOOD MICROWAVE OTR OVEN
- A valid SKU must start with a LETTER and contain at least one number
- If this page is a FLOOR PLAN (top-down view with no elevation), return {"cabinets":[]}
- If no cabinet SKUs are readable, still try to extract boxes by visual measurement and position
- Round all dimensions to nearest whole inch
${unitType ? `- Unit type context: ${unitType}` : ""}

Return ONLY valid JSON — no markdown fences, no explanation:
{"cabinets":[{"sku":"B24","type":"Base","room":"Kitchen","width":24,"height":34,"depth":24,"quantity":1}]}`;

    let response: Response | null = null;
    const MAX_RETRIES = 3;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
          response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "openai/gpt-5-mini",
              messages: [{ role: "user", content: [
                { type: "image_url", image_url: { url: `data:image/jpeg;base64,${pageImage}` } },
                { type: "text", text: prompt },
              ]}],
              temperature: 0.1, max_tokens: 4096,
            }),
          });
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
        return new Response(JSON.stringify({ error: "AI model temporarily unavailable. Please try again in a moment.", cabinets: [] }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      break;
    }

    if (!response) {
      return new Response(JSON.stringify({ error: "AI model temporarily unavailable. Please try again in a moment.", cabinets: [] }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (!response.ok) {
      const errText = await response.text();
      console.error("AI gateway error:", response.status, errText);
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "rate_limit" }), {
          status: 429,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "credits" }), {
          status: 402,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({ error: `AI error: ${response.status}`, cabinets: [] }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiData = await response.json();
    const content: string = aiData.choices?.[0]?.message?.content ?? "";
    console.log("AI raw response:", content.slice(0, 800));

    let parsed: { cabinets: any[] } = { cabinets: [] };
    try {
      // Strip markdown fences if model wraps in them
      const cleaned = content
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/```\s*$/i, "")
        .trim();
      parsed = JSON.parse(cleaned);
    } catch {
      console.error("JSON parse failed, raw:", content.slice(0, 500));
    }

    const cabinets = (parsed.cabinets ?? [])
      .filter((c: any) => c.sku && /^[A-Za-z]/.test(c.sku))
      .map((c: any) => ({
        sku: String(c.sku).toUpperCase().trim(),
        type: c.type ?? "Base",
        room: c.room ?? "Kitchen",
        width: Number(c.width) || 24,
        height: Number(c.height) || 34,
        depth: Number(c.depth) || 24,
        quantity: Number(c.quantity) || 1,
      }));

    return new Response(JSON.stringify({ cabinets }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("extract-pdf-cabinets error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
