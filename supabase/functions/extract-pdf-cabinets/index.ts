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

      const systemPrompt = `You are an expert at reading architectural millwork / cabinet schedules extracted from PDF floor plans or cabinet elevation sheets.

Your job is to extract ALL cabinet line items from the provided floor plan text. Each cabinet entry should include:
- SKU / model number (e.g. B24, W3036, DB36, UB30, etc.)
- Cabinet type: "Base", "Wall", "Tall", or "Vanity"
- Room: "Kitchen", "Pantry", "Laundry", "Bath", or "Other"
- Width in inches (numeric only)
- Height in inches (numeric only)  
- Depth in inches (numeric only)
- Quantity (default 1 if not specified)

RULES:
- Cabinet SKUs are typically alphanumeric codes: B24, W3630, DB24, OH30, UT84, etc.
- Dimensions appear as WxHxD or W"xH"xD" or listed in a schedule table
- Base cabinets: typically 34.5" tall, 24" deep
- Wall cabinets: typically 12-42" tall, 12" deep
- Tall cabinets: typically 84-96" tall, 24" deep
- Vanity cabinets: typically 31-35" tall, 21" deep
- If a SKU appears multiple times with same dimensions, sum the quantities
- If dimensions can't be parsed, use standard defaults for the type
- Ignore purely structural elements, doors, windows, electrical

${unitType ? `Focus on cabinets for unit type: ${unitType}` : 'Extract all cabinets found on the page'}

Return ONLY valid JSON, no markdown, no explanation:
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

      const userPrompt = `Page ${i + 1} floor plan / cabinet schedule text:\n\n${pageText.slice(0, 10000)}`;

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
