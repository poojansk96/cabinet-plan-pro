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

    const prompt = `You are an expert millwork estimator analyzing a countertop shop drawing.

TASK: Identify ONLY the edges that have a DOUBLE LINE (two closely spaced parallel lines). Double lines indicate backsplash or sidesplash material.

INSTRUCTIONS:
1. Look at every countertop piece in the drawing.
2. For each piece, scan ALL edges carefully. A "double line" means two parallel lines drawn very close together along an edge — this is how backsplash/sidesplash is indicated in shop drawings.
3. For each edge that has a double line, read its dimension value from the drawing labels.
4. Group the results by category: "kitchen" or "bath".
   - Bath: pieces near bathroom fixtures (toilet, tub, shower), or text says "bath"/"vanity"/"powder", or depth ≤ 22"
   - Kitchen: everything else
5. Return ALL individual double-line dimension values per category.

IMPORTANT RULES:
- ONLY include dimensions where you can clearly see a DOUBLE LINE on that edge. Single-line edges have NO backsplash — do not include them.
- Read the exact dimension value as labeled on the drawing (e.g., 129", 39 1/4", 27", 25 1/4", 47 1/2", 22").
- Convert fractions to decimals: 1/4 = 0.25, 1/2 = 0.5, 3/4 = 0.75, 1/8 = 0.125, 3/8 = 0.375
- Round to nearest 0.25 inch.
- Include BOTH long backsplash runs AND short sidesplash returns — any edge with a double line counts.
- Islands (large pieces with no double lines) should have zero dimensions.
- If the page has no countertop drawings, return empty groups.

Return ONLY valid JSON — no markdown, no explanation:
{"groups":[{"category":"kitchen","dimensions":[129,39.25,27,25.25],"totalInches":220.5},{"category":"bath","dimensions":[47.5,22,22],"totalInches":91.5}]}`;

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
              generationConfig: { temperature: 0.1, maxOutputTokens: 4096 },
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
        return new Response(JSON.stringify({ error: "AI model temporarily unavailable.", groups: [] }), {
          status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      break;
    }

    if (!response) {
      return new Response(JSON.stringify({ error: "AI model temporarily unavailable.", groups: [] }), {
        status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
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
      return new Response(JSON.stringify({ error: `AI error: ${response.status}`, groups: [] }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiData = await response.json();
    const content: string = aiData.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    console.log("AI backsplash raw:", content.slice(0, 500));

    let parsed: { groups: { category: string; dimensions: number[]; totalInches: number }[] } = { groups: [] };
    try {
      let cleaned = content.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
      const jsonStart = cleaned.lastIndexOf('{"groups"');
      if (jsonStart > 0) cleaned = cleaned.slice(jsonStart);
      parsed = JSON.parse(cleaned);
    } catch {
      console.error("JSON parse failed for backsplash, raw:", content.slice(0, 500));
      // Try regex recovery
      const groups: { category: string; dimensions: number[]; totalInches: number }[] = [];
      const catMatch = content.matchAll(/"category"\s*:\s*"(kitchen|bath)"/gi);
      for (const m of catMatch) {
        const cat = m[1].toLowerCase();
        // Find dimensions array near this match
        const after = content.slice(m.index! + m[0].length, m.index! + m[0].length + 200);
        const dimMatch = after.match(/\[([0-9.,\s]+)\]/);
        if (dimMatch) {
          const dims = dimMatch[1].split(',').map(s => Number(s.trim())).filter(n => n > 0);
          groups.push({ category: cat, dimensions: dims, totalInches: dims.reduce((a, b) => a + b, 0) });
        }
      }
      parsed = { groups };
    }

    // Normalize groups
    const normalizedGroups = (parsed.groups || []).map(g => {
      const dims = (g.dimensions || []).map(d => Math.round(Number(d || 0) * 4) / 4).filter(d => d > 0);
      return {
        category: String(g.category || "kitchen").toLowerCase() as "kitchen" | "bath",
        dimensions: dims,
        totalInches: Math.round(dims.reduce((a, b) => a + b, 0) * 4) / 4,
      };
    }).filter(g => g.dimensions.length > 0);

    return new Response(JSON.stringify({ groups: normalizedGroups }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("extract-pdf-backsplash error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
