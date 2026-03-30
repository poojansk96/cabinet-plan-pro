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

    const { pageImage } = await req.json();

    if (!pageImage || typeof pageImage !== "string") {
      return new Response(JSON.stringify({ error: "pageImage (base64 string) required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const prompt = `You are an expert millwork estimator analyzing a 2020 countertop shop drawing page.

TASK:
1. Find the UNIT TYPE NAME from the drawing's title block (usually bottom-right or top). Examples: "TYPE 1.1A (ADA)", "TYPE 2.1B-AS", "STUDIO", etc. Extract the EXACT and COMPLETE name. If none visible, use "".

2. Extract ONLY vanity tops (bathroom tops). Ignore all kitchen countertops. Vanity tops are identified by:
   - Depth of 22" or less (commonly 22", 19", 18")
   - Labels mentioning "vanity", "bath", "lav", "powder"
   - Typically have an oval or round bowl cutout drawn
   - Boxed/separate from kitchen countertop runs

3. For EACH vanity top, extract:
   a. **length** — total length in inches (e.g., 47.5, 31, 25)
   b. **depth** — depth in inches (usually 22")
   c. **bowlPosition** — examine the bowl cutout location:
      - If the bowl is NOT centered horizontally, it is "offset". Determine which side it is closer to:
        - "offset-left" if bowl center is closer to the left edge
        - "offset-right" if bowl center is closer to the right edge
      - If the bowl is centered horizontally (equal distance from both edges), it is "center"
   d. **bowlOffset** — if offset, measure the distance in inches from the CLOSER edge to the center of the bowl. This is usually dimensioned in the drawing (e.g., 17.75" from left edge). If center, set to null.
   e. **leftWall** — true if the LEFT side of the vanity top shows a DOUBLE LINE (two parallel lines close together) at the left edge. Double lines indicate the vanity is against a wall on that side, which means there would be a sidesplash. A single line means an open/exposed edge.
   f. **rightWall** — true if the RIGHT side shows a DOUBLE LINE at the right edge. Same logic as leftWall.
   
RULES FOR WALL DETECTION (CRITICAL):
- A DOUBLE LINE (two parallel lines very close together, ~0.5-1" apart) at the edge of a vanity top means there is a WALL on that side.
- A SINGLE LINE at the edge means the edge is OPEN (exposed/finished).
- Look carefully at both the LEFT and RIGHT short edges of the rectangular vanity drawing.
- The backsplash (back wall) is typically always present — focus on detecting LEFT and RIGHT wall indicators.
- Double lines = sidesplash present on that side.

RULES FOR BOWL POSITION:
- Look for dimension lines showing the distance from the vanity edge to the bowl centerline.
- If the drawing shows a measurement like "17 3/4"" from one side, that's the bowlOffset.
- If both sides have equal dimensions to the bowl center, it's "center".
- Convert fractions to decimals: 3/4 = 0.75, 1/2 = 0.5, 1/4 = 0.25, 3/8 = 0.375

IMPORTANT:
- Only extract vanity/bathroom tops. Skip ALL kitchen countertops (depth > 22").
- If the page has no vanity tops, return {"unitTypeName":"","vtops":[]}
- Round all dimensions to nearest 0.25 inch.

Return ONLY valid JSON — no markdown fences, no explanation:
{"unitTypeName":"TYPE 1.1A (ADA)","vtops":[{"length":47.5,"depth":22,"bowlPosition":"offset-left","bowlOffset":17.75,"leftWall":true,"rightWall":true}]}`;

    const MODELS = [
      { name: "gemini-3-flash-preview", retries: 3 },
      { name: "gemini-2.5-pro", retries: 2 },
    ];

    let response: Response | null = null;
    for (const { name: model, retries: MAX_RETRIES } of MODELS) {
      console.log(`Trying model: ${model} (${MAX_RETRIES} attempts)`);
      let succeeded = false;
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
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
          console.error(`AI fetch error (${model}, attempt ${attempt + 1}):`, fetchErr);
          if (attempt < MAX_RETRIES - 1) { await new Promise(r => setTimeout(r, 2000 * (attempt + 1))); continue; }
          response = null;
          break;
        }

        if (response && (response.status === 503 || response.status === 500)) {
          console.warn(`AI unavailable (${response.status}) for ${model}, attempt ${attempt + 1}/${MAX_RETRIES}`);
          response = null;
          if (attempt < MAX_RETRIES - 1) { await new Promise(r => setTimeout(r, 2000 * (attempt + 1))); continue; }
          break;
        }
        succeeded = true;
        break;
      }
      if (succeeded && response) break;
      console.warn(`Model ${model} failed, trying next fallback...`);
    }

    if (!response) {
      return new Response(JSON.stringify({ error: "AI model temporarily unavailable.", unitTypeName: "", vtops: [] }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (!response.ok) {
      const errText = await response.text();
      console.error("AI error:", response.status, errText);
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "rate_limit" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "credits" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ error: `AI error: ${response.status}`, unitTypeName: "", vtops: [] }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const aiData = await response.json();
    const content: string = aiData.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    console.log("AI vtop raw:", content.slice(0, 800));

    let parsed: { unitTypeName?: string; vtops: any[] } = { vtops: [] };
    try {
      let cleaned = content.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
      const jsonStart = cleaned.indexOf('{"unitTypeName"');
      if (jsonStart >= 0) {
        cleaned = cleaned.slice(jsonStart);
      } else {
        const altStart = cleaned.indexOf('{"vtops"');
        if (altStart > 0) cleaned = cleaned.slice(altStart);
      }
      parsed = JSON.parse(cleaned);
    } catch {
      console.error("JSON parse failed, raw:", content.slice(0, 500));
    }

    const unitTypeName = String(parsed.unitTypeName || "").trim();
    console.log("Detected unit type name:", unitTypeName);

    const vtops = (parsed.vtops ?? []).map((vt: any) => {
      const length = Math.round((Number(vt.length) || 31) * 4) / 4;
      const depth = Math.round((Number(vt.depth) || 22) * 4) / 4;
      const bowlPosition = ["offset-left", "offset-right", "center"].includes(vt.bowlPosition)
        ? vt.bowlPosition
        : "center";
      const bowlOffset = bowlPosition !== "center" ? (Math.round((Number(vt.bowlOffset) || 0) * 4) / 4) : null;
      const leftWall = Boolean(vt.leftWall);
      const rightWall = Boolean(vt.rightWall);

      return { length, depth, bowlPosition, bowlOffset, leftWall, rightWall };
    });

    return new Response(JSON.stringify({ unitTypeName, vtops }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("extract-pdf-vtops error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
