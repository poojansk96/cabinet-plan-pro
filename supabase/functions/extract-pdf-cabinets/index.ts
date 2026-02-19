import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    if (!LOVABLE_API_KEY) throw new Error("LOVABLE_API_KEY is not configured");

    const { pageTexts, unitType } = await req.json();
    if (!pageTexts || !Array.isArray(pageTexts)) {
      return new Response(JSON.stringify({ error: "pageTexts array required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const allCabinets: Record<string, any> = {};

    for (let i = 0; i < pageTexts.length; i++) {
      const pageText = pageTexts[i];
      if (!pageText || pageText.trim().length < 20) continue;

      const systemPrompt = `You are an expert millwork estimator reading cabinet ELEVATION drawings extracted from PDFs.

Cabinet elevations show a FRONT VIEW of cabinets as they appear mounted on walls. The extracted text contains:
- Cabinet model/SKU codes labeled on each cabinet box (e.g. B24, W3036, DB30, UB18, OH36, SB24, UT84, etc.)
- Dimensions labeled per cabinet (width in inches, sometimes height)
- Elevation/room title labels (e.g. "KITCHEN ELEVATION A", "BATH ELEVATION 2", "LAUNDRY ELEV")
- Quantities when the same cabinet repeats (e.g. "(2) B24" or "B24 x2")

CABINET TYPE IDENTIFICATION:
- BASE: B, DB, SB, CB, EB prefixes — bottom row of elevation — default H=34.5", D=24"
- WALL: W, UB, OH, UC, WC prefixes — upper row of elevation — default H=30", D=12"  
- TALL: T, UT, TC, PTC, OC, PT prefixes — full-height column — default H=84", D=24"
- VANITY: V, VB, VD prefixes — bathroom, shorter base — default H=34.5", D=21"
- When prefix is ambiguous, use position in elevation: upper row=Wall, lower row=Base, full height=Tall

ROOM IDENTIFICATION:
- Look for elevation title keywords: KITCHEN→"Kitchen", BATH/LAVATORY→"Bath", LAUNDRY/UTIL→"Laundry", PANTRY→"Pantry"
- Default to "Kitchen" if unclear

CRITICAL RULES:
1. Each distinct cabinet box on the elevation = one line item with quantity
2. Width comes from the dimension label on that cabinet box (e.g. 24" or 24W)
3. If the same SKU + same dimensions appear multiple times on one elevation, sum quantities
4. DO NOT include appliances: REF, REFRIG, DW, DISHWASHER, RANGE, HOOD, MICROWAVE, OTR, MW
5. DO NOT include dimension strings, grid references, or drawing title block numbers as SKUs
6. A valid SKU always starts with a letter and contains numbers (e.g. B24, W3036, not just "24" or "A")
7. If a cabinet width cannot be found, estimate from surrounding context or use 24" default for Base/Tall, 30" for Wall

${unitType ? `These elevations are for unit type: ${unitType}` : ''}

Return ONLY valid JSON, no markdown:
{
  "cabinets": [
    {
      "sku": "B24",
      "type": "Base",
      "room": "Kitchen",
      "width": 24,
      "height": 34.5,
      "depth": 24,
      "quantity": 1
    }
  ]
}`;

      const userPrompt = `Page ${i + 1} cabinet elevation text:\n\n${pageText.slice(0, 12000)}`;

      const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.1,
        }),
      });

      if (!response.ok) {
        if (response.status === 429) {
          return new Response(
            JSON.stringify({ error: "Rate limit exceeded. Please try again shortly." }),
            { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        if (response.status === 402) {
          return new Response(
            JSON.stringify({ error: "AI usage limit reached." }),
            { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        const errText = await response.text();
        console.error("AI gateway error:", response.status, errText);
        continue;
      }

      const aiData = await response.json();
      const content = aiData.choices?.[0]?.message?.content ?? "";

      let parsed: { cabinets: any[] } | null = null;
      try {
        const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        parsed = JSON.parse(cleaned);
      } catch {
        console.error("Failed to parse AI response for page", i + 1, content);
        continue;
      }

      if (!parsed?.cabinets) continue;

      for (const cab of parsed.cabinets) {
        const sku = (cab.sku ?? "").trim().toUpperCase();
        if (!sku) continue;
        const key = `${sku}__${cab.type}__${cab.room}__${cab.width}__${cab.height}__${cab.depth}`;

        if (allCabinets[key]) {
          allCabinets[key].quantity += (cab.quantity ?? 1);
        } else {
          allCabinets[key] = {
            sku,
            type: cab.type ?? "Base",
            room: cab.room ?? "Kitchen",
            width: Number(cab.width) || 24,
            height: Number(cab.height) || 34.5,
            depth: Number(cab.depth) || 24,
            quantity: cab.quantity ?? 1,
          };
        }
      }
    }

    const cabinets = Object.values(allCabinets).sort((a: any, b: any) =>
      a.sku.localeCompare(b.sku, undefined, { numeric: true })
    );

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
