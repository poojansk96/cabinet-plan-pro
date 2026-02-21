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

WHAT IS A UNIT NUMBER:
- A unit number is a numeric or alphanumeric identifier for a residential/commercial unit (apartment, condo, suite)
- Examples of VALID unit numbers: "101", "102", "201", "102A", "PH-1", "305", "1A", "2B"
- Unit numbers are typically short (1-5 characters), mostly numeric, and identify a physical dwelling unit

WHAT IS NOT A UNIT NUMBER (DO NOT extract these as unitNumber):
- Type names like "TYPE A", "A1-As", "2BHK", "Studio", "1 Bedroom" — these are unit TYPES, not numbers
- Call-out addresses like "A1-As", "B2-Cs", "C3" that identify drawing references
- Room labels like "Kitchen", "Bath", "Living Room"
- Cabinet SKUs like "B24", "W3036", "VB24"
- Notes, annotations, or drawing titles
- Building/floor/wing labels

Look for:
1. Unit schedules or legend tables listing unit numbers with their types
2. Floor plan labels showing unit numbers (e.g. "101", "102") inside or near unit outlines
3. Title block text like "KITCHEN – TYPE A" with unit numbers listed nearby

RULES:
- unitNumber MUST be a dwelling unit identifier — primarily numeric like "101", "202", "PH-1", "305A"
- unitType should be the type designation like "TYPE A", "A1-As", "2BHK", "Studio"
- Do NOT put type names or call-out addresses in the unitNumber field
- If NO valid unit numbers found, return {"units":[]}

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

    // Filter: unit numbers must look like actual dwelling unit identifiers
    const isValidUnitNumber = (val: string): boolean => {
      const upper = val.toUpperCase();
      if (!/\d/.test(val)) return false;
      if (/^[A-Z]{1,2}\d{2,4}$/i.test(val)) return false; // cabinet SKUs
      if (/^TYPE\s/i.test(upper)) return false;
      if (/^[A-Z]\d+-[A-Z]/i.test(val) && val.length <= 6) return false; // call-outs
      if (/^(KITCHEN|BATH|LIVING|BEDROOM|MASTER|DINING|LAUNDRY|PANTRY|CLOSET)/i.test(upper)) return false;
      if (/^(FLOOR|LEVEL|BUILDING|BLDG|TOWER|WING|BLOCK|EAST|WEST|NORTH|SOUTH)/i.test(upper)) return false;
      if (val.length > 10) return false;
      return true;
    };

    const units = (parsed.units ?? [])
      .filter((u: any) => u.unitNumber && u.unitType && typeof u.unitNumber === "string" && typeof u.unitType === "string")
      .map((u: any) => ({
        unitNumber: String(u.unitNumber).trim(),
        unitType: String(u.unitType).trim(),
      }))
      .filter(u => isValidUnitNumber(u.unitNumber));

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
