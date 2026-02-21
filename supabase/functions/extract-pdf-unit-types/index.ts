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

    const prompt = `You are an expert architectural drawing analyst specializing in reading residential and commercial floor plans and 2020 Design shop drawings. Your job is to extract EVERY unit number and its associated unit type from this page. Missing even one unit is unacceptable.

STEP 1 — CLASSIFY THIS PAGE:
Determine what type of page this is:
- "title_page": A cover/title page showing project info, unit schedules, or a list of units
- "floor_plan": A floor plan view showing unit layouts from above with unit numbers labeled. Floor plans show MULTIPLE units on a single floor, with walls, doors, rooms visible from a top-down view.
- "elevation": A cabinet elevation drawing showing a FRONT VIEW of cabinets on a wall with SKUs and dimensions for a SINGLE room (NOT a top-down view)
- "other": Any other type of page (notes, details, cover sheets with no unit data)

CRITICAL CLASSIFICATION RULES:
- If you see ANY unit numbers/labels on the page with room layouts from above → "floor_plan"
- If you see a top-down architectural layout with doors, walls, corridors → "floor_plan"  
- ONLY classify as "elevation" if the page shows a FRONT VIEW of cabinets (not top-down)
- When in doubt, ALWAYS choose "floor_plan" — it is BETTER to extract and get empty results than to skip a page
- EVERY floor of a building has units — do NOT skip any floor plan page
- Pages showing Floor 1, Floor 2, Floor 3, etc. are ALL floor plans — extract units from ALL of them
- A page with even a SINGLE unit number visible MUST be classified as "floor_plan" or "title_page"

IMPORTANT: 
- If this page is an "elevation" or "other", return {"pageType":"elevation","units":[]} or {"pageType":"other","units":[]}
- ONLY extract unit numbers and types from "title_page" or "floor_plan" pages

STEP 2 — EXTRACT UNITS (only for title_page or floor_plan):

SYSTEMATIC EXTRACTION PROCESS:
1. First, scan the ENTIRE page methodically — left to right, top to bottom
2. Look at EVERY text label visible on the page
3. For each area that looks like a dwelling unit, find its number AND type
4. Count the total units you found. Compare against the visual layout — if you see 8 unit outlines but only found 6 numbers, look harder for the missing ones
5. Check edges, corners, and overlapping text areas for missed labels

WHERE TO FIND UNIT NUMBERS:
- At DOOR LOCATIONS — unit numbers are commonly placed at the entry door, in the corridor/hallway
- At the EDGE/BOUNDARY of the unit outline, facing the corridor
- Near stairwells and elevator lobbies
- In unit schedule tables or legends on the page
- Sometimes very small text near doorways — zoom in mentally and read carefully

WHERE TO FIND UNIT TYPES:
- INSIDE the unit boundary — centered or near a room label (e.g. "Unit A", "Type B", "2BR-A")
- In schedule/legend tables that map unit numbers to types
- Sometimes in the title block area

CRITICAL DISTINCTION: The number at the door/edge = unitNumber. The label inside the unit = unitType. They are DIFFERENT fields.

WHAT IS A UNIT NUMBER:
- A numeric or alphanumeric identifier: "101", "102", "201", "102A", "PH-1", "305", "1A", "2B"
- Typically 2-5 characters, mostly numeric
- NOT type names like "TYPE A", "A1-As", "2BHK", "Studio"
- NOT cabinet SKUs like "B24", "W3036"
- NOT room labels, notes, or page numbers

BUILDING NAME:
- Look for building/tower name in title block, header, or footer
- Examples: "Building A", "Tower 1", "Bldg 2", "North Tower"
- If no building name found, use null

CRITICAL RULES:
- Extract EVERY unit on the page — do NOT skip any
- Read EVERY digit carefully — "330" not "33", "1201" not "120"
- If a unit has no type visible, set unitType to "" — do NOT skip the unit
- If the same unit number appears multiple times, include it only once

Return ONLY valid JSON — no markdown, no explanation:
{"pageType":"floor_plan","bldg":"Building A","units":[{"unitNumber":"101","unitType":"TYPE A"},{"unitNumber":"102","unitType":"TYPE A"}]}`;

    const aiModel = useDirectGemini ? "gemini-2.5-pro" : "google/gemini-2.5-pro";

    let aiRes: Response | null = null;
    const MAX_RETRIES = 3;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        if (useDirectGemini) {
          aiRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${aiModel}:generateContent?key=${GEMINI_API_KEY}`,
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
              model: aiModel,
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
