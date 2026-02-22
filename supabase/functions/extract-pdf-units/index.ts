import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const systemPrompt = `You are an expert architectural drawing reader specializing in residential construction floor plans.

STEP 1 — FIND THE BUILDING NAME FIRST (most important):
Scan every word of the page text for a building identifier. Building names appear in many forms:
- Directional: "East Building", "West Building", "North Wing", "South Tower", "East Wing", "West Block"
- Numbered: "Building 1", "Building 2", "Bldg 1", "Bldg. 2", "Bldg A", "Block 1", "Block A"  
- Named: "Tower A", "Tower B", "Phase 1", "Phase 2", "Phase II", "Wing A", "Wing B"
- Combined: "Building 1 - East", "North Tower Phase 2", "West Block Bldg A"
- Project name followed by building: "Maple Gardens East Building", "Sunset Heights Bldg 2"
- Title block text (often at top or bottom): look for lines like "BUILDING: East", "BLDG: 1", "PROJECT: ... BUILDING: ..."
- Sheet title: e.g. "FLOOR PLAN - EAST BUILDING LEVEL 2" → building = "East Building"

RULE: If you find ANY building identifier anywhere on the page, set pageBuilding to it and apply to ALL units on that page unless a unit clearly has a different building label.

STEP 2 — FIND UNITS WITH CABINETS/COUNTERTOPS:
Identify all spaces (residential units and common areas) that have cabinet or countertop content nearby.

CABINET/COUNTERTOP SIGNALS: cabinet, counter, CT, countertop, DW, sink, refrigerator, kitchen, kitch, range, cooktop, dishwasher, microwave, upper cab, lower cab, base cab, lin ft, linear ft, granite, marble, quartz, laminate, undermount, island, peninsula, vanity, lav, laundry tub, washer, dryer, W/D, folding counter, community room, fitness, clubhouse, leasing office

UNIT TYPES TO DETECT:
1. Residential: "Unit 101", "Apt 3B", "A-101", "B204", "101A", "#201"
2. Common areas with cabinet content: Laundry rooms → "LAUNDRY-1", Community kitchens → "COMM-KITCHEN", Community rooms → "COMMUNITY ROOM 115", Pantries → "PANTRY-A", Clubhouses → "CLUBHOUSE", Leasing offices → "LEASING-OFFICE", Fitness rooms → "FITNESS-1"

RULES:
- Only include spaces where cabinet/countertop signals appear near that space on the plan
- If unsure whether a space has cabinets, use kitchenConfidence "maybe"
- Unit type: capture FULL type name exactly as written (e.g. "Type A5 - 2 Bedroom Corner Unit"). Never abbreviate.
- Floor: normalize word numbers ("First Floor" → "1", "Second" → "2", "Ground" → "G", "Basement" → "B1"). Keep letter-based levels as-is: "Level A" → "A", "Level B" → "B", "Level C" → "C", etc.
- Building: always inherit pageBuilding if unit has no specific building label

Return ONLY valid JSON (no markdown fences, no explanation):
{
  "pageBuilding": "East Building" | null,
  "units": [
    {
      "unitNumber": "101",
      "detectedType": "Type A - 2 Bedroom" | null,
      "detectedFloor": "1" | null,
      "detectedBldg": "East Building" | null,
      "kitchenConfidence": "yes" | "maybe"
    }
  ]
}`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const useDirectGemini = !!GEMINI_API_KEY;
    if (!GEMINI_API_KEY && !LOVABLE_API_KEY) throw new Error("No AI API key configured");

    const body = await req.json();
    
    // Support single-page mode: { pageText, pageIndex }
    const pageText = body.pageText as string | undefined;
    const pageIndex = (body.pageIndex as number) ?? 0;
    
    if (!pageText || typeof pageText !== "string") {
      return new Response(JSON.stringify({ error: "pageText required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (pageText.trim().length < 20) {
      return new Response(JSON.stringify({ units: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const titleBlock = pageText.slice(0, 1500);
    const tailBlock = pageText.slice(-800);
    const userPrompt = `Analyze this floor plan page (page ${pageIndex + 1}).\n\nSHEET TITLE / HEADER AREA (check here first for building name):\n${titleBlock}\n\nFOOTER / TITLE BLOCK:\n${tailBlock}\n\nFULL PAGE TEXT:\n${pageText.slice(0, 8000)}`;

    let response: Response | null = null;
    const MAX_RETRIES = 3;
    const apiKey = (useDirectGemini ? GEMINI_API_KEY : LOVABLE_API_KEY)!;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        if (useDirectGemini) {
          response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${apiKey}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                contents: [{ role: "user", parts: [{ text: systemPrompt + "\n\n" + userPrompt }] }],
                generationConfig: { temperature: 0.1 },
              }),
            }
          );
        } else {
          response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "google/gemini-2.5-flash",
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: userPrompt },
              ],
              temperature: 0.1,
            }),
          });
        }
      } catch (fetchErr) {
        console.error(`Page ${pageIndex + 1} fetch error (attempt ${attempt + 1}):`, fetchErr);
        if (attempt < MAX_RETRIES - 1) { await new Promise(r => setTimeout(r, 2000 * (attempt + 1))); continue; }
        break;
      }

      if (response && (response.status === 503 || response.status === 500)) {
        console.warn(`Page ${pageIndex + 1} AI unavailable (${response.status}), attempt ${attempt + 1}`);
        response = null;
        if (attempt < MAX_RETRIES - 1) { await new Promise(r => setTimeout(r, 3000 * (attempt + 1))); continue; }
        break;
      }
      if (response && response.status === 429) {
        return new Response(JSON.stringify({ error: "rate_limit" }), {
          status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      if (response && response.status === 402) {
        return new Response(JSON.stringify({ error: "credits" }), {
          status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      break;
    }

    if (!response || !response.ok) {
      return new Response(JSON.stringify({ units: [] }), {
        status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiData = await response.json();
    const content = useDirectGemini
      ? (aiData.candidates?.[0]?.content?.parts?.[0]?.text ?? "")
      : (aiData.choices?.[0]?.message?.content ?? "");

    let parsed: { pageBuilding?: string | null; units: any[] } | null = null;
    try {
      const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      parsed = JSON.parse(cleaned);
    } catch {
      // Try to find JSON object in response
      const match = content.match(/\{[\s\S]*"units"\s*:\s*\[[\s\S]*\]\s*\}/);
      if (match) {
        try { parsed = JSON.parse(match[0]); } catch {}
      }
      if (!parsed) {
        console.error("Failed to parse AI response for page", pageIndex + 1, content.slice(0, 300));
        return new Response(JSON.stringify({ units: [] }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const pageBuilding = parsed.pageBuilding ?? null;
    const units = (parsed.units ?? []).map((u: any) => ({
      unitNumber: (u.unitNumber ?? "").trim(),
      detectedType: u.detectedType ?? null,
      detectedFloor: u.detectedFloor ?? null,
      detectedBldg: u.detectedBldg ?? pageBuilding ?? null,
      kitchenConfidence: u.kitchenConfidence ?? "maybe",
    })).filter((u: any) => u.unitNumber.length > 0);

    console.log(`Page ${pageIndex + 1}: found ${units.length} units`);

    return new Response(JSON.stringify({ units }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("extract-pdf-units error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
