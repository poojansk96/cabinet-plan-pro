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

    const { pageImages, scaleFactor, scaleLabel, unitType } = await req.json();

    if (!pageImages || !Array.isArray(pageImages) || pageImages.length === 0) {
      return new Response(JSON.stringify({ error: "pageImages array required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const allCabinets: Record<string, any> = {};

    for (let i = 0; i < pageImages.length; i++) {
      const imageBase64 = pageImages[i];
      if (!imageBase64) continue;

      const systemPrompt = `You are an expert millwork estimator analyzing a cabinet ELEVATION drawing.

The drawing is shown at scale: ${scaleLabel} (meaning 1 drawn inch = ${scaleFactor} real inches).

Your job:
1. Visually identify every cabinet box in the elevation drawing
2. Read each cabinet's SKU/model label (e.g. B24, W3036, T84, VB30)
3. Measure the WIDTH of each cabinet box using the drawing scale:
   - Estimate the cabinet box width in drawn inches from the image
   - Multiply by ${scaleFactor} to get real-world inches
   - Cross-check with any dimension annotations on the drawing (these take priority)
4. Identify the cabinet TYPE from its position and SKU prefix:
   - BASE (B, DB, SB, CB): bottom row cabinets, default H=34.5", D=24"
   - WALL (W, UB, OH, WC): upper row cabinets mounted on wall, default H=30", D=12"
   - TALL (T, UT, TC, PT): full-height cabinets spanning floor to upper, default H=84", D=24"
   - VANITY (V, VB, VD): bathroom base cabinets, default H=34.5", D=21"
5. Identify the ROOM from the elevation title (KITCHEN, BATH, LAUNDRY, PANTRY, etc.)
6. Count QUANTITY — if the same cabinet model repeats in this elevation, add quantities

DIMENSION PRIORITY:
1. Explicit dimension labels printed ON the drawing (most accurate)
2. Your visual measurement of the drawn box width × scale factor
3. Width encoded in the SKU (B24 = 24" wide, W3036 = 30" wide)
4. Standard defaults

CRITICAL RULES:
- Do NOT include appliances: REF, REFRIGERATOR, DW, DISHWASHER, RANGE, HOOD, MICROWAVE, OTR, OVEN
- A valid SKU starts with a letter and contains numbers (B24, W3036, T84 — NOT just "24" or numbers)
- Round all dimensions to nearest whole inch
- If the page is a floor plan (top-down view), not an elevation (front view), return empty cabinets array
${unitType ? `- These elevations belong to unit type: ${unitType}` : ""}

Return ONLY valid JSON (no markdown, no explanation):
{
  "cabinets": [
    {
      "sku": "B24",
      "type": "Base",
      "room": "Kitchen",
      "width": 24,
      "height": 34,
      "depth": 24,
      "quantity": 1
    }
  ]
}`;

      const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-pro",
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image_url",
                  image_url: {
                    url: `data:image/jpeg;base64,${imageBase64}`,
                  },
                },
                {
                  type: "text",
                  text: systemPrompt,
                },
              ],
            },
          ],
          temperature: 0.1,
        }),
      });

      if (!response.ok) {
        const errText = await response.text();
        console.error(`AI gateway error on page ${i + 1}:`, response.status, errText);
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
        // Skip this page on other errors but continue
        continue;
      }

      const aiData = await response.json();
      const content = aiData.choices?.[0]?.message?.content ?? "";

      let parsed: { cabinets: any[] } | null = null;
      try {
        const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        parsed = JSON.parse(cleaned);
      } catch {
        console.error(`Failed to parse AI response for page ${i + 1}:`, content.slice(0, 500));
        continue;
      }

      if (!parsed?.cabinets) continue;

      for (const cab of parsed.cabinets) {
        const sku = (cab.sku ?? "").trim().toUpperCase();
        if (!sku || !/^[A-Z]/.test(sku)) continue; // must start with letter

        const key = `${sku}__${cab.type}__${cab.room}__${cab.width}__${cab.height}__${cab.depth}`;

        if (allCabinets[key]) {
          allCabinets[key].quantity += (cab.quantity ?? 1);
        } else {
          allCabinets[key] = {
            sku,
            type: cab.type ?? "Base",
            room: cab.room ?? "Kitchen",
            width: Number(cab.width) || 24,
            height: Number(cab.height) || 34,
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
