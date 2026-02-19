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
Your job is to identify RESIDENTIAL UNIT identifiers that have kitchen cabinets, countertops, or cabinet/countertop-related drawings on the floor plan.

Rules:
- ONLY include units that show evidence of kitchen/cabinet/countertop content (keywords: cabinet, counter, CT, DW, sink, refrigerator, kitchen, kitch, range, cooktop, dishwasher, microwave, upper cab, lower cab, base cab, lin ft, linear ft, granite, marble, quartz, laminate, undermount, overmount, island, peninsula)
- If a unit number appears on a page that mentions any of those keywords, include it with kitchenConfidence "yes"  
- If the page has some kitchen-related content but you're unsure if THIS specific unit has it, use "maybe"
- NEVER include units from pages with NO kitchen/cabinet content at all
- Unit identifiers look like: "Unit 101", "Apt 3B", "A-101", "B204", "101A", "#201", numbers 100-9999 preceded by unit/apt/suite keywords
- DO NOT include: dimension numbers, room areas, door tags, grid references, scale numbers, year numbers, drawing numbers
- Unit type: capture the FULL type name EXACTLY as written (e.g. "Type A5 - 2 Bedroom", "Plan B3-1BR", "A - 2 BR Unit"). NOT just "A" or "2BR"
- Floor: look for "Level X", "Floor X", "1st Floor", "Ground Floor", etc.
- If no units with kitchen/cabinet content are found, return empty array

Return ONLY valid JSON, no markdown, no explanation:
{
  "units": [
    {
      "unitNumber": "101",
      "detectedType": "Type A - 2 Bedroom" | null,
      "detectedFloor": "Floor 1" | null,
      "kitchenConfidence": "yes" | "maybe"
    }
  ]
}`;

      const userPrompt = `Page ${i + 1} floor plan text:\\n\\n${pageText.slice(0, 8000)}`;

      const response = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${LOVABLE_API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: "google/gemini-3-flash-preview",
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
      let parsed: { units: any[] } | null = null;
      try {
        const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
        parsed = JSON.parse(cleaned);
      } catch {
        console.error("Failed to parse AI response for page", i + 1, content);
        continue;
      }

      if (!parsed?.units) continue;

      for (const unit of parsed.units) {
        const key = (unit.unitNumber ?? "").trim().toUpperCase();
        if (!key || key.length < 1) continue;

        const existing = allUnits[key];
        // Merge: prefer "yes" kitchen confidence; keep best type/floor
        if (!existing) {
          allUnits[key] = {
            unitNumber: key,
            detectedType: unit.detectedType ?? null,
            detectedFloor: unit.detectedFloor ?? null,
            detectedBldg: null,
            rawMatch: key,
            page: i + 1,
            confidence: "high" as const,
            kitchenConfidence: unit.kitchenConfidence ?? "maybe",
          };
        } else {
          if (!existing.detectedType && unit.detectedType) existing.detectedType = unit.detectedType;
          if (!existing.detectedFloor && unit.detectedFloor) existing.detectedFloor = unit.detectedFloor;
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
