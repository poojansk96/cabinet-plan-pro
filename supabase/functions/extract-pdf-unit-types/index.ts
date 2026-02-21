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
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const useDirectGemini = !!GEMINI_API_KEY;
    if (!GEMINI_API_KEY && !LOVABLE_API_KEY) throw new Error("No AI API key configured");

    const { pageImage } = await req.json();

    if (!pageImage || typeof pageImage !== "string") {
      return new Response(JSON.stringify({ error: "pageImage (base64 string) required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const prompt = `You are an expert at reading 2020 Design shop drawings and residential/commercial architectural drawings.

STEP 1 — CLASSIFY THIS PAGE:
First, determine what type of page this is:
- "title_page": A cover/title page showing project info, unit schedules, or a list of units
- "floor_plan": A floor plan view showing unit layouts from above with unit numbers labeled. Floor plans show MULTIPLE units on a single floor, with walls, doors, rooms visible from a top-down view.
- "elevation": A cabinet elevation drawing showing a FRONT VIEW of cabinets on a wall with SKUs and dimensions for a SINGLE room (NOT a top-down view)
- "other": Any other type of page (notes, details, cover sheets with no unit data)

CRITICAL CLASSIFICATION RULES:
- If you see MULTIPLE unit numbers/labels on the page with room layouts from above → "floor_plan"
- If you see a top-down architectural layout with doors, walls, corridors → "floor_plan"
- ONLY classify as "elevation" if the page shows a FRONT VIEW of cabinets (not top-down)
- When in doubt between floor_plan and other types, choose "floor_plan" — better to extract and filter than miss units
- EVERY floor of a building has units — do NOT skip any floor plan page

IMPORTANT: 
- If this page is an "elevation" or "other", return {"pageType":"elevation","units":[]} or {"pageType":"other","units":[]}
- ONLY extract unit numbers and types from "title_page" or "floor_plan" pages
- Elevation pages show detailed cabinet drawings for a single unit type — do NOT extract unit data from them

STEP 2 — EXTRACT UNITS (only for title_page or floor_plan):

WHAT IS A UNIT NUMBER:
- A unit number is a numeric or alphanumeric identifier for a residential/commercial unit (apartment, condo, suite)
- Examples: "101", "102", "201", "102A", "PH-1", "305", "1A", "2B", "230", "330", "430"
- Unit numbers are typically 2-5 characters, mostly numeric

WHAT IS NOT A UNIT NUMBER:
- Type names like "TYPE A", "A1-As", "2BHK", "Studio" — these are unit TYPES
- Cabinet SKUs like "B24", "W3036", "VB24"
- Room labels, notes, annotations, page numbers

BUILDING NAME:
- Look for a building or tower name in the title block, header, or project info
- Examples: "Building A", "Tower 1", "Bldg 2", "North Tower", "Phase 1"
- If multiple buildings are referenced, associate each unit with its building
- If no building name is found, use null

Look for:
1. Unit schedules or legend tables listing unit numbers with their types
2. Floor plan labels showing unit numbers inside or near unit outlines
3. Title block text with unit numbers listed nearby
4. Building/tower identifiers in headers or title blocks
5. Unit numbers at DOOR LOCATIONS — on architectural floor plans, unit numbers are often placed at the entry door or at the edge/boundary of a unit, NOT inside. Look near doorways, corridors, and hallway-facing edges.
6. Unit TYPE NAMES INSIDE the unit — the type designation (e.g. "Unit A", "Type B", "2BR-A") is often written INSIDE the unit boundary, in the center or near a room label. Do NOT confuse the type name inside the unit with the unit number.
7. IMPORTANT DISTINCTION: The number at the door/edge = unitNumber. The label inside the unit = unitType. They are different fields.

CRITICAL RULES:
- unitNumber MUST be a dwelling unit identifier — can be numeric ("101", "202", "PH-1") OR letter-based ("A", "B", "C", "Unit A", "Unit B")
- unitType should be the type designation. Type names can appear in many forms:
  * Standard: "TYPE A", "A1-As", "2BHK", "Studio", "1BR"
  * Named as "Unit X": If the plan labels types as "Unit A", "Unit B", "Unit C" etc., use those as the unitType (e.g. unitType: "Unit A")
  * If a schedule or legend maps unit numbers to type names, use exactly what is written
  * If no type is found or it's unclear, set unitType to "" (empty string). Do NOT skip units just because they lack a type.
- bldg should be the building/tower name if found, or null
- Read EVERY digit carefully — do not truncate (e.g. "330" not "33")
- If NO valid unit numbers found, return {"pageType":"title_page","units":[]}

Return ONLY valid JSON — no markdown, no explanation:
{"pageType":"floor_plan","bldg":"Building A","units":[{"unitNumber":"101","unitType":"TYPE A"},{"unitNumber":"102","unitType":"TYPE A"}]}`;

    let aiRes: Response | null = null;
    const MAX_RETRIES = 3;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        if (useDirectGemini) {
          aiRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                contents: [{ role: "user", parts: [
                  { inlineData: { mimeType: "image/jpeg", data: pageImage } },
                  { text: prompt },
                ]}],
                generationConfig: { temperature: 0.1, maxOutputTokens: 16384 },
              }),
            }
          );
        } else {
          aiRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: "google/gemini-2.5-flash",
              messages: [{ role: "user", content: [
                { type: "image_url", image_url: { url: `data:image/jpeg;base64,${pageImage}` } },
                { type: "text", text: prompt },
              ]}],
              temperature: 0.1, max_tokens: 16384,
            }),
          });
        }
      } catch (fetchErr) {
        console.error(`AI fetch error (attempt ${attempt + 1}):`, fetchErr);
        if (attempt < MAX_RETRIES - 1) { await new Promise(r => setTimeout(r, 2000 * (attempt + 1))); continue; }
        throw fetchErr;
      }

      if (aiRes.status === 503 || aiRes.status === 500) {
        const errText = await aiRes.text();
        console.warn(`AI unavailable (${aiRes.status}), attempt ${attempt + 1}/${MAX_RETRIES}:`, errText.slice(0, 200));
        aiRes = null;
        if (attempt < MAX_RETRIES - 1) { await new Promise(r => setTimeout(r, 3000 * (attempt + 1))); continue; }
        return new Response(JSON.stringify({ error: "AI model temporarily unavailable. Please try again in a moment.", units: [], pageType: "unknown" }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      break;
    }

    if (!aiRes) {
      return new Response(JSON.stringify({ error: "AI model temporarily unavailable. Please try again in a moment.", units: [], pageType: "unknown" }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (!aiRes.ok) {
      const errText = await aiRes.text();
      console.error("AI gateway error:", aiRes.status, errText);
      if (aiRes.status === 429) return new Response(JSON.stringify({ error: "rate_limit" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (aiRes.status === 402) return new Response(JSON.stringify({ error: "credits" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ error: `AI error: ${aiRes.status}`, units: [], pageType: "unknown" }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const aiData = await aiRes.json();
    const content: string = useDirectGemini
      ? (aiData.candidates?.[0]?.content?.parts?.[0]?.text ?? "")
      : (aiData.choices?.[0]?.message?.content ?? "");
    console.log("AI raw response:", content.slice(0, 800));

    let parsed: { units: any[]; pageType?: string; bldg?: string } = { units: [] };
    try {
      // Strip markdown fences (handles multi-line content)
      let cleaned = content.trim();
      const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (fenceMatch) {
        cleaned = fenceMatch[1].trim();
      }
      parsed = JSON.parse(cleaned);
    } catch {
      // If JSON is truncated, try to salvage partial data
      console.error("JSON parse failed:", content.slice(0, 400));
      try {
        let partial = content.trim();
        const fm = partial.match(/```(?:json)?\s*([\s\S]*)/);
        if (fm) partial = fm[1].trim();
        // Remove trailing incomplete object and close arrays
        partial = partial.replace(/,\s*\{[^}]*$/, '');
        if (!partial.endsWith(']}')) partial += ']}';
        parsed = JSON.parse(partial);
        console.log("Salvaged partial JSON with", (parsed.units ?? []).length, "units");
      } catch {
        console.error("Partial salvage also failed");
      }
    }

    const pageType = parsed.pageType || "unknown";
    const pageBldg = parsed.bldg || null;
    console.log("Page type:", pageType, "Bldg:", pageBldg);

    // Skip elevation and other pages
    if (pageType === "elevation" || pageType === "other") {
      console.log("Skipping page — type:", pageType);
      return new Response(JSON.stringify({ units: [], pageType, skipped: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Filter: unit numbers must look like actual dwelling unit identifiers
    const isValidUnitNumber = (val: string): boolean => {
      const upper = val.toUpperCase();
      // Allow letter-only unit numbers like "A", "B", "C" (single letters or short alpha)
      // But reject known non-unit labels
      if (/^TYPE\s/i.test(upper)) return false;
      if (/^(KITCHEN|BATH|LIVING|BEDROOM|MASTER|DINING|LAUNDRY|PANTRY|CLOSET)/i.test(upper)) return false;
      if (/^(FLOOR|LEVEL|BUILDING|BLDG|TOWER|WING|BLOCK|EAST|WEST|NORTH|SOUTH)/i.test(upper)) return false;
      if (/^(ELEVATION|ELEV)\b/i.test(upper)) return false;
      if (val.length > 10) return false;
      if (val.length < 1) return false;
      return true;
    };

    let units = (parsed.units ?? [])
      .filter((u: any) => u.unitNumber && typeof u.unitNumber === "string")
      .map((u: any) => ({
        unitNumber: String(u.unitNumber).trim(),
        unitType: u.unitType ? String(u.unitType).trim() : "",
        bldg: String(u.bldg || pageBldg || "").trim() || null,
      }))
      .filter(u => isValidUnitNumber(u.unitNumber));

    // Post-processing: check digit count consistency
    if (units.length >= 2) {
      const numericUnits = units.filter(u => /^\d+$/.test(u.unitNumber));
      if (numericUnits.length >= 2) {
        const lengthCounts: Record<number, number> = {};
        for (const u of numericUnits) {
          const len = u.unitNumber.length;
          lengthCounts[len] = (lengthCounts[len] || 0) + 1;
        }
        let maxCount = 0;
        let dominantLength = 0;
        for (const [len, count] of Object.entries(lengthCounts)) {
          if (count > maxCount) {
            maxCount = count;
            dominantLength = Number(len);
          }
        }
        if (maxCount > 1 || numericUnits.length > 2) {
          units = units.filter(u => {
            if (!/^\d+$/.test(u.unitNumber)) return true;
            return u.unitNumber.length >= dominantLength;
          });
        }
      }
    }

    console.log("Validated units:", JSON.stringify(units));

    return new Response(JSON.stringify({ units, pageType }), {
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
