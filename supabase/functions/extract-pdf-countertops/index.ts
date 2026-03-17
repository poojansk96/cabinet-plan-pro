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

    const prompt = `You are an expert millwork estimator analyzing a countertop / stone plan from 2020 shop drawings.

TASK:
1. First, look at the TITLE BLOCK (usually bottom-right or top of the page). Extract the **unit type name** exactly as written. Examples: "1.1B-AS", "TYPE A", "2BR-MIRROR", "A2", "STUDIO", "1.1A", "TOWNHOUSE". This is the plan/unit type identifier, NOT the room name. If you see "TYPE 1.1B - AS" the unitType is "1.1B-AS". If you see "PLAN A2 MIRROR" the unitType is "A2-MIRROR". If no type is visible, set unitType to null.

2. Then extract every countertop section visible. For each section extract:
   a. **label** — a short descriptive name based on its location (e.g. "Perimeter Left", "Island", "Vanity", "L-Section"). If the drawing has text labels, use those.
   b. **length** — total linear length in inches. Read dimension labels first. If no label, estimate from the drawing.
   c. **depth** — depth in inches. Standard kitchen countertop depth is 25.5". Islands are often 36-42". Vanity/bath tops are typically 22" or 19". Read from labels or use defaults.
   d. **category** — classify as "kitchen" or "bath":
      - If the drawing shows bathroom fixtures (toilet, tub), or text says "bath", "vanity", "powder", "master bath", "ensuite" → "bath"
      - If depth is 22" or less, or 19" → "bath"
      - Otherwise → "kitchen"
   e. **hasBacksplash** — true if you see a double line along the back edge of the countertop (indicating a backsplash), or if the drawing annotates a backsplash. false otherwise.
   f. **room** — the room this countertop is in (Kitchen, Bath, Laundry, Bar, Pantry, etc.)

RULES:
- Look for dimension lines, annotations, and measurements in the drawing
- For L-shaped or U-shaped runs, break them into individual straight segments
- If a countertop wraps around a corner, create separate sections for each leg
- Do NOT include appliance surfaces (range top, sink cutout dimensions) as separate sections — they are part of the countertop run
- If the page has no countertop information, return {"unitType":null,"countertops":[]}
- Round all dimensions to nearest 0.5 inch
- Standard depths: perimeter kitchen = 25.5", island = 36", bar = 12-18", vanity/bath = 22"
- A double line at the back wall edge means backsplash is present
- The unitType is the PLAN/UNIT TYPE identifier from the title block — NOT a room name like "Kitchen" or "Bath"

Return ONLY valid JSON — no markdown fences, no explanation:
{"unitType":"1.1B-AS","countertops":[{"label":"Perimeter Left","length":96,"depth":25.5,"category":"kitchen","hasBacksplash":true,"room":"Kitchen"}]}`;

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
        return new Response(JSON.stringify({ error: "AI model temporarily unavailable.", countertops: [], unitType: null }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      break;
    }

    if (!response) {
      return new Response(JSON.stringify({ error: "AI model temporarily unavailable.", countertops: [], unitType: null }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
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
      return new Response(JSON.stringify({ error: `AI error: ${response.status}`, countertops: [], unitType: null }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const aiData = await response.json();
    const content: string = aiData.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    console.log("AI countertop raw:", content.slice(0, 800));

    let parsed: { countertops: any[]; unitType?: string | null } = { countertops: [], unitType: null };
    try {
      let cleaned = content.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
      // Find the last valid JSON object
      const jsonStart = cleaned.lastIndexOf('{"unitType"');
      const fallbackStart = cleaned.lastIndexOf('{"countertops"');
      const start = jsonStart >= 0 ? jsonStart : fallbackStart;
      if (start > 0) cleaned = cleaned.slice(start);
      parsed = JSON.parse(cleaned);
    } catch {
      console.error("JSON parse failed, raw:", content.slice(0, 500));
    }

    // Clean up the unit type — preserve ALL names from the drawing as-is
    let unitType: string | null = null;
    if (parsed.unitType && typeof parsed.unitType === "string") {
      let ut = parsed.unitType.trim().toUpperCase();
      // Remove "TYPE " prefix if present
      ut = ut.replace(/^TYPE\s+/, "");
      if (ut.length > 0 && ut.length <= 30) {
        unitType = ut;
      }
    }

    const countertops = (parsed.countertops ?? []).map((ct: any) => {
      const depth = Math.round((Number(ct.depth) || 25.5) * 2) / 2;
      // Fallback classification: depth <= 22 → bath, else kitchen
      let category: string = String(ct.category || "").toLowerCase();
      if (category !== "kitchen" && category !== "bath") {
        category = depth <= 22 ? "bath" : "kitchen";
      }
      return {
        label: String(ct.label || "Section").trim(),
        length: Math.round((Number(ct.length) || 96) * 2) / 2,
        depth,
        hasBacksplash: Boolean(ct.hasBacksplash),
        category,
        room: String(ct.room || "Kitchen").trim(),
      };
    });

    return new Response(JSON.stringify({ countertops, unitType }), {
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
