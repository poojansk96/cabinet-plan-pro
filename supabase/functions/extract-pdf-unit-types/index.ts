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

    const { pageImage } = await req.json();

    if (!pageImage || typeof pageImage !== "string") {
      return new Response(JSON.stringify({ error: "pageImage (base64 string) required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const prompt = `You are an expert at reading 2020 Design shop drawings and residential/commercial architectural drawings.

TASK: Extract all UNIT TYPE labels and their counts from this page.

Look for:
1. Unit type schedules or legend tables listing unit types with counts (most reliable source)
2. Floor plan labels identifying unit types — e.g. "TYPE A", "UNIT TYPE 1", "2BHK", "1BHK", "Studio", "Townhouse", "Penthouse", "Suite A", "Plan B", etc.
3. Elevation title blocks — e.g. "KITCHEN – TYPE A" or "BATH – 2BHK" → unit type is "TYPE A" or "2BHK"
4. Repeated labels across multiple unit outlines on the same page — each distinct label = one unit type
5. Title block text identifying the unit type for the whole sheet

RULES:
- Extract the unit type name EXACTLY as written on the drawing
- For count: use the number from a schedule/legend if present; otherwise count how many times that unit type label appears on the page; default 1 if truly unknown
- Merge duplicate unit types (same label = same type)
- If this page is a floor plan overview showing multiple units, count each labeled unit
- SKIP generic room labels like "Kitchen", "Bath", "Living" — those are rooms, not unit types
- SKIP cabinet labels like B24, W3036 — those are cabinet SKUs, not unit types
- If NO unit type information at all, return {"units":[]}

Return ONLY valid JSON — no markdown, no explanation:
{"units":[{"unitType":"TYPE A","count":24},{"unitType":"TYPE B","count":12}]}`;

    const aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
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
              { type: "image_url", image_url: { url: `data:image/jpeg;base64,${pageImage}` } },
              { type: "text", text: prompt },
            ],
          },
        ],
        temperature: 0.1,
        max_tokens: 2048,
      }),
    });

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      console.error("AI gateway error:", aiRes.status, errText);
      if (aiRes.status === 429) return new Response(JSON.stringify({ error: "rate_limit" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (aiRes.status === 402) return new Response(JSON.stringify({ error: "credits" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ error: `AI error: ${aiRes.status}`, units: [] }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const aiData = await aiRes.json();
    const content: string = aiData.choices?.[0]?.message?.content ?? "";
    console.log("AI raw response:", content.slice(0, 600));

    let parsed: { units: any[] } = { units: [] };
    try {
      const cleaned = content
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/```\s*$/i, "")
        .trim();
      parsed = JSON.parse(cleaned);
    } catch {
      console.error("JSON parse failed:", content.slice(0, 400));
    }

    const units = (parsed.units ?? [])
      .filter((u: any) => u.unitType && typeof u.unitType === "string" && u.unitType.trim())
      .map((u: any) => ({
        unitType: String(u.unitType).trim(),
        count: Math.max(1, Number(u.count) || 1),
      }));

    return new Response(JSON.stringify({ units }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("extract-pdf-unit-types error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
