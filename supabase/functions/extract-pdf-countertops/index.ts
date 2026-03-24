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

    const prompt = `You are an expert millwork estimator analyzing a 2020 countertop shop drawing.

TASK:
Examine this drawing and extract every countertop section visible. For each section extract:

1. **label** — a short descriptive name based on its location (e.g. "Perimeter Left", "Perimeter Right", "Island", "Peninsula", "Bar Top", "Vanity", "L-Section", "U-Section"). If the drawing has text labels, use those.
2. **length** — total linear length in inches. Read dimension labels first. If no label, estimate from the drawing.
3. **depth** — depth in inches. Read from dimension labels. Standard kitchen countertop depth is 25.5". Vanity/bath tops are typically 22" or 19" deep. Islands are often 36-42".
4. **backsplashLength** — the linear inches of backsplash shown. Look for DOUBLE LINES drawn along the wall edge of the countertop — these indicate backsplash. The backsplash length is the total linear inches of those double lines. If no double lines or backsplash indication, use 0.
5. **isIsland** — true if this section is an island or peninsula (not against a wall, typically depth >= 30").
6. **category** — classify as "kitchen" or "bath". Use these rules:
   - If depth is 22" or less (19", 22", etc.) → "bath"  
   - If the label or room mentions "vanity", "bath", "bathroom", "lav", "powder" → "bath"
   - Everything else → "kitchen"

RULES:
- Look for dimension lines, annotations, and measurements in the drawing
- For L-shaped or U-shaped runs, break them into individual straight segments
- If a countertop wraps around a corner, create separate sections for each leg
- Do NOT include appliance surfaces (range top, sink cutout dimensions) as separate sections — they are part of the countertop run
- If the page has no countertop information, return {"countertops":[]}
- Round all dimensions to nearest 0.5 inch
- IMPORTANT: Look carefully for double lines along walls — these are backsplash indicators. Measure their total length.
- Standard depths: perimeter = 25.5", island = 36", bar = 12-18", vanity = 22"

Return ONLY valid JSON — no markdown fences, no explanation:
{"countertops":[{"label":"Perimeter Left","length":96,"depth":25.5,"backsplashLength":96,"isIsland":false,"category":"kitchen"}]}`;

    let response: Response | null = null;
    const MAX_RETRIES = 3;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${GEMINI_API_KEY}`,
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
      } catch (fetchErr) {
        console.error(`AI fetch error (attempt ${attempt + 1}):`, fetchErr);
        if (attempt < MAX_RETRIES - 1) { await new Promise(r => setTimeout(r, 2000 * (attempt + 1))); continue; }
        throw fetchErr;
      }

      if (response && (response.status === 503 || response.status === 500)) {
        console.warn(`AI unavailable (${response.status}), attempt ${attempt + 1}/${MAX_RETRIES}`);
        response = null;
        if (attempt < MAX_RETRIES - 1) { await new Promise(r => setTimeout(r, 3000 * (attempt + 1))); continue; }
        return new Response(JSON.stringify({ error: "AI model temporarily unavailable.", countertops: [] }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      break;
    }

    if (!response) {
      return new Response(JSON.stringify({ error: "AI model temporarily unavailable.", countertops: [] }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
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
      return new Response(JSON.stringify({ error: `AI error: ${response.status}`, countertops: [] }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const aiData = await response.json();
    const content: string = aiData.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    console.log("AI countertop raw:", content.slice(0, 800));

    let parsed: { countertops: any[] } = { countertops: [] };
    try {
      let cleaned = content.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
      const jsonStart = cleaned.lastIndexOf('{"countertops"');
      if (jsonStart > 0) cleaned = cleaned.slice(jsonStart);
      parsed = JSON.parse(cleaned);
    } catch {
      console.error("JSON parse failed, raw:", content.slice(0, 500));
    }

    const countertops = (parsed.countertops ?? []).map((ct: any) => {
      const depth = Math.round((Number(ct.depth) || 25.5) * 2) / 2;
      // Auto-classify based on depth if category not provided
      let category = String(ct.category || "").toLowerCase().trim();
      if (!category || (category !== "kitchen" && category !== "bath")) {
        const label = String(ct.label || "").toLowerCase();
        if (depth <= 22 || /vanity|bath|lav|powder/.test(label)) {
          category = "bath";
        } else {
          category = "kitchen";
        }
      }

      return {
        label: String(ct.label || "Section").trim(),
        length: Math.round((Number(ct.length) || 96) * 2) / 2,
        depth,
        backsplashLength: Math.round((Number(ct.backsplashLength) || 0) * 2) / 2,
        isIsland: Boolean(ct.isIsland),
        category,
      };
    });

    return new Response(JSON.stringify({ countertops }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("extract-pdf-countertops error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
