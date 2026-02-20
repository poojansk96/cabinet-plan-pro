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

TASK: Extract all UNIT NUMBERS and their associated UNIT TYPE from this page.

Look for:
1. Unit schedules or legend tables listing unit numbers with their types (most reliable source)
2. Floor plan labels showing unit numbers (e.g. "101", "102", "201", "Unit 305") next to or inside unit outlines, with a unit type label nearby (e.g. "TYPE A", "A1-As", "2BHK", "Studio")
3. Title block text identifying which unit type this sheet belongs to — e.g. "KITCHEN – TYPE A" or "Unit 101 – Type A1-As"
4. Tables or schedules mapping unit numbers to unit types
5. Multiple units on the same page — each unit number should be captured with its type

RULES:
- Extract the unit NUMBER exactly as written (e.g. "101", "102A", "PH-1")
- Extract the unit TYPE exactly as written (e.g. "TYPE A", "A1-As", "2BHK", "Studio")
- Each row should have one unitNumber and one unitType
- If a page shows a single unit type with multiple unit numbers listed, create one entry per unit number all sharing that type
- If a schedule shows unit numbers mapped to types, extract each mapping
- SKIP generic room labels like "Kitchen", "Bath", "Living" — those are rooms, not unit types
- SKIP cabinet labels like B24, W3036 — those are cabinet SKUs
- If NO unit information at all, return {"units":[]}

Return ONLY valid JSON — no markdown, no explanation:
{"units":[{"unitNumber":"101","unitType":"TYPE A"},{"unitNumber":"102","unitType":"TYPE A"},{"unitNumber":"201","unitType":"TYPE B"}]}`;

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
        max_tokens: 4096,
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
    console.log("AI raw response:", content.slice(0, 800));

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
      .filter((u: any) => u.unitNumber && u.unitType && typeof u.unitNumber === "string" && typeof u.unitType === "string")
      .map((u: any) => ({
        unitNumber: String(u.unitNumber).trim(),
        unitType: String(u.unitType).trim(),
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
