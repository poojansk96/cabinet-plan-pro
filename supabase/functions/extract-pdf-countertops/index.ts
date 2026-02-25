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
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!OPENAI_API_KEY && !GEMINI_API_KEY) throw new Error("No AI provider key configured");

    const { pageImage } = await req.json();

    if (!pageImage || typeof pageImage !== "string") {
      return new Response(JSON.stringify({ error: "pageImage (base64 string) required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const prompt = `You are an expert millwork estimator analyzing a countertop / kitchen plan drawing.

TASK:
Examine this drawing and extract every countertop section visible. For each section extract:

1. **label** — a short descriptive name based on its location (e.g. "Perimeter Left", "Perimeter Right", "Island", "Peninsula", "Bar Top", "Vanity", "L-Section", "U-Section"). If the drawing has text labels, use those.
2. **length** — total linear length in inches. Read dimension labels first. If no label, estimate from the drawing.
3. **depth** — depth in inches. Standard countertop depth is 25.5". Islands are often 36-42". Read from labels or use defaults.
4. **splashHeight** — backsplash height in inches if noted (typically 4" or 6"). Use null if not shown.
5. **isIsland** — true if this section is an island or peninsula (not against a wall).
6. **room** — the room this countertop is in (Kitchen, Bath, Laundry, Bar, Pantry, etc.)

RULES:
- Look for dimension lines, annotations, and measurements in the drawing
- For L-shaped or U-shaped runs, break them into individual straight segments
- If a countertop wraps around a corner, create separate sections for each leg
- Do NOT include appliance surfaces (range top, sink cutout dimensions) as separate sections — they are part of the countertop run
- If the page has no countertop information, return {"countertops":[]}
- Round all dimensions to nearest 0.5 inch
- Standard depths: perimeter = 25.5", island = 36", bar = 12-18", vanity = 22"

Return ONLY valid JSON — no markdown fences, no explanation:
{"countertops":[{"label":"Perimeter Left","length":96,"depth":25.5,"splashHeight":4,"isIsland":false,"room":"Kitchen"}]}`;

    let response: Response | null = null;
    let content = "";
    const MAX_RETRIES = 3;

    if (OPENAI_API_KEY) {
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: { Authorization: `Bearer ${OPENAI_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "gpt-4o-mini",
              messages: [{ role: "user", content: [
                { type: "image_url", image_url: { url: `data:image/jpeg;base64,${pageImage}` } },
                { type: "text", text: prompt },
              ]}],
              temperature: 0.2, max_tokens: 8192,
            }),
          });
        } catch (fetchErr) {
          console.error(`AI openai fetch error (attempt ${attempt + 1}):`, fetchErr);
          if (attempt < MAX_RETRIES - 1) { await new Promise(r => setTimeout(r, 2000 * (attempt + 1))); continue; }
          response = null;
          break;
        }

        if (response && (response.status === 503 || response.status === 500)) {
          console.warn(`AI openai unavailable (${response.status}), attempt ${attempt + 1}/${MAX_RETRIES}`);
          response = null;
          if (attempt < MAX_RETRIES - 1) { await new Promise(r => setTimeout(r, 3000 * (attempt + 1))); continue; }
          break;
        }
        break;
      }
    }

    const shouldTryGemini = Boolean(GEMINI_API_KEY) && (
      !OPENAI_API_KEY ||
      !response ||
      (response.status === 429 || response.status === 402 || response.status === 500 || response.status === 503)
    );

    if (shouldTryGemini) {
      console.warn(`OpenAI unavailable/quota-limited, falling back to Gemini`);
      const geminiResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{
              parts: [
                { inline_data: { mime_type: "image/jpeg", data: pageImage } },
                { text: prompt },
              ],
            }],
            generationConfig: {
              temperature: 0.2,
              maxOutputTokens: 8192,
              responseMimeType: "application/json",
            },
          }),
        },
      );

      if (geminiResponse.ok) {
        const geminiData = await geminiResponse.json();
        content = (geminiData.candidates?.[0]?.content?.parts ?? [])
          .map((part: any) => part.text ?? "")
          .join("\n")
          .trim();
      } else {
        const errText = await geminiResponse.text();
        console.error("Gemini fallback error:", geminiResponse.status, errText);
        response = geminiResponse;
      }
    }

    if (!content) {
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
      content = aiData.choices?.[0]?.message?.content ?? "";
    }

    console.log("AI countertop raw:", content.slice(0, 800));

    let parsed: { countertops: any[] } = { countertops: [] };
    try {
      let cleaned = content.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
      // Try to find JSON object if there's reasoning text before it
      const jsonStart = cleaned.lastIndexOf('{"countertops"');
      if (jsonStart > 0) cleaned = cleaned.slice(jsonStart);
      parsed = JSON.parse(cleaned);
    } catch {
      console.error("JSON parse failed, raw:", content.slice(0, 500));
    }

    const countertops = (parsed.countertops ?? []).map((ct: any) => ({
      label: String(ct.label || "Section").trim(),
      length: Math.round((Number(ct.length) || 96) * 2) / 2,
      depth: Math.round((Number(ct.depth) || 25.5) * 2) / 2,
      splashHeight: ct.splashHeight ? Math.round(Number(ct.splashHeight) * 2) / 2 : null,
      isIsland: Boolean(ct.isIsland),
      room: String(ct.room || "Kitchen").trim(),
    }));

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
