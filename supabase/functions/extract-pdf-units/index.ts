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

    const { pageTexts } = await req.json();
    if (!pageTexts || !Array.isArray(pageTexts)) {
      return new Response(JSON.stringify({ error: "pageTexts array required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Process pages in batches to stay within token limits
    const allUnits: Record<string, any> = {};

    for (let i = 0; i < pageTexts.length; i++) {
      const pageText = pageTexts[i];
      if (!pageText || pageText.trim().length < 20) continue;

      const systemPrompt = `You are an expert at reading architectural floor plan text extracted from PDFs.
Your job is to identify ALL spaces — both residential units AND common/shared areas — that have cabinet, countertop, or cabinetry-related drawings.

CABINET/COUNTERTOP KEYWORDS (if any appear near a space, include it):
cabinet, counter, CT, countertop, DW, sink, refrigerator, kitchen, kitch, range, cooktop, dishwasher, microwave, upper cab, lower cab, base cab, lin ft, linear ft, granite, marble, quartz, laminate, undermount, overmount, island, peninsula, vanity, lav, laundry tub, washer, dryer, W/D, folding counter

WHAT TO DETECT:
1. Residential units: "Unit 101", "Apt 3B", "A-101", "B204", "101A", "#201", etc.
2. Common/shared area spaces that have cabinet or countertop content:
   - Laundry rooms / laundry units (e.g. "Laundry Room", "Laundry 1", "Common Laundry") → unitNumber like "LAUNDRY-1"
   - Community kitchens / common kitchens (e.g. "Community Kitchen", "Common Kitchen") → unitNumber like "COMM-KITCHEN"
   - Pantry rooms (e.g. "Pantry", "Pantry Room") → unitNumber like "PANTRY-A"
   - Clubhouses / amenity kitchens (e.g. "Clubhouse", "Club Room", "Amenity Kitchen") → unitNumber like "CLUBHOUSE"
   - Leasing offices with kitchenettes (e.g. "Leasing Office", "Management Office") → unitNumber like "LEASING-OFFICE"
   - Mail rooms, Fitness rooms, Lounge areas IF they show cabinet/counter content
   - Any other labeled common area with cabinet/counter signals

RULES:
- ONLY include spaces where cabinet/countertop keywords appear near that space label on the same plan
- If keywords appear on the page but you are unsure if THIS specific space has them, use kitchenConfidence "maybe"
- DO NOT include: pure dimension numbers, room area tags, door tags, grid refs, scale numbers, drawing numbers
- Unit type:
  - For residential units: capture FULL type name EXACTLY as written (e.g. "Type A5 - 2 Bedroom", "Plan B3-1BR"). NOT just "A" or "2BR"
  - For common areas: use a clear descriptive label (e.g. "Common Laundry", "Community Kitchen", "Pantry", "Clubhouse Kitchen", "Leasing Office")
- Floor: look for "Level X", "Floor X", "1st Floor", "Ground Floor", "Basement", "Mezzanine", "P1", "G" (ground), etc. Normalize word numbers ("First" → "1", "Second" → "2").
- Building: IMPORTANT — scan the ENTIRE page for any building identifier. Look for:
  * Explicit labels: "Building 1", "Building A", "Bldg 2", "Bldg. A", "Block A", "Block 3"
  * Tower/wing labels: "Tower B", "Tower North", "Wing C", "Wing East"
  * Phase labels: "Phase 1", "Phase 2", "Phase II"
  * Directional building names: "North Building", "South Tower", "East Wing", "West Block", "Central Building"
  * Title block text: building name often appears in the drawing title block at top or bottom of page
  * If the page title or header contains a building reference, use it for ALL units on that page
  * If multiple building identifiers exist, assign the nearest one to each unit
  * Capture EXACTLY as written (e.g. "Building A", "Bldg 2", "North Tower", "Block C")
  * If the whole page clearly belongs to one building, set pageBuilding to that value and apply to all units
- If no spaces with cabinet/countertop content are found, return empty array.

Return ONLY valid JSON, no markdown, no explanation:
{
  "pageBuilding": "Building A" | null,
  "units": [
    {
      "unitNumber": "101",
      "detectedType": "Type A - 2 Bedroom" | null,
      "detectedFloor": "Floor 1" | null,
      "detectedBldg": "Building A" | null,
      "kitchenConfidence": "yes" | "maybe"
    }
  ]
}`;

      const userPrompt = `Page ${i + 1} floor plan text:\n\n${pageText.slice(0, 8000)}`;

      const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-2.5-flash",
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.1,
        }),
      });

      if (!response.ok) {
        if (response.status === 429) {
          return new Response(
            JSON.stringify({ error: "Rate limit exceeded. Please try again shortly." }),
            { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        if (response.status === 402) {
          return new Response(
            JSON.stringify({ error: "AI usage limit reached. Please add credits in Settings → Workspace → Usage." }),
            { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } }
          );
        }
        const errText = await response.text();
        console.error("AI gateway error:", response.status, errText);
        continue; // Skip this page on error, don't fail everything
      }

      const aiData = await response.json();
      const content = aiData.choices?.[0]?.message?.content ?? "";

      // Parse JSON from AI response (strip markdown fences if present)
      let parsed: { pageBuilding?: string | null; units: any[] } | null = null;
      try {
        const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        parsed = JSON.parse(cleaned);
      } catch {
        console.error("Failed to parse AI response for page", i + 1, content);
        continue;
      }

      if (!parsed?.units) continue;

      // Page-level building fallback: if AI identified one building for the whole page
      const pageBuilding = parsed.pageBuilding ?? null;

      for (const unit of parsed.units) {
        const key = (unit.unitNumber ?? "").trim().toUpperCase();
        if (!key || key.length < 1) continue;

        // Resolve building: unit-level takes priority, then page-level
        const bldg = unit.detectedBldg ?? pageBuilding ?? null;

        const existing = allUnits[key];
        if (!existing) {
          allUnits[key] = {
            unitNumber: key,
            detectedType: unit.detectedType ?? null,
            detectedFloor: unit.detectedFloor ?? null,
            detectedBldg: bldg,
            rawMatch: key,
            page: i + 1,
            confidence: "high" as const,
            kitchenConfidence: unit.kitchenConfidence ?? "maybe",
          };
        } else {
          if (!existing.detectedType && unit.detectedType) existing.detectedType = unit.detectedType;
          if (!existing.detectedFloor && unit.detectedFloor) existing.detectedFloor = unit.detectedFloor;
          if (!existing.detectedBldg && bldg) existing.detectedBldg = bldg;
          if (existing.kitchenConfidence === "maybe" && unit.kitchenConfidence === "yes") {
            existing.kitchenConfidence = "yes";
          }
        }
      }
    }

    const detectedUnits = Object.values(allUnits).sort((a: any, b: any) =>
      a.unitNumber.localeCompare(b.unitNumber, undefined, { numeric: true })
    );

    return new Response(JSON.stringify({ detectedUnits }), {
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
