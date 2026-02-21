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
- "floor_plan": A floor plan view showing unit layouts from above with unit numbers labeled
- "elevation": A cabinet elevation drawing showing a FRONT VIEW of cabinets on a wall with SKUs and dimensions
- "other": Any other type of page (notes, details, cover sheets with no unit data)

STEP 2 — EXTRACT UNIT NUMBERS FROM **EVERY** PAGE TYPE:

CRITICAL: You must extract unit numbers from ALL page types, including elevation pages. 
- On 2020 Design shop drawings, EVERY page has a TITLE BLOCK (usually at the bottom or right side) that contains the unit number/identifier for that page.
- Even "elevation" pages belong to a specific unit — find the unit number in the title block.
- The title block typically shows: project name, unit number/ID, room name, page number, date.
- Common title block unit formats: "01-105", "UNIT 201", "APT 3B", "Suite 105", "#202", or just a number like "105".

WHERE TO FIND UNIT NUMBERS:
1. **TITLE BLOCK** (bottom or right of page) — ALWAYS check this first. Every 2020 Design page has one.
2. At DOOR LOCATIONS on floor plans — near doorways, corridors, hallway-facing edges
3. At the EDGE/BOUNDARY of unit outlines
4. In unit schedule tables or legends
5. Near stairwells and elevator lobbies

WHERE TO FIND UNIT TYPES:
- INSIDE the unit boundary on floor plans (e.g. "Unit A", "Type B", "2BR-A")
- In schedule/legend tables mapping unit numbers to types
- In the title block — sometimes the type is listed alongside the unit number
- If no type is found, set unitType to "" — do NOT skip the unit

WHAT IS A UNIT NUMBER:
- A numeric or alphanumeric dwelling identifier: "101", "01-105", "202", "PH-1", "305", "1A", "2B"
- Can include hyphens or dashes: "01-105", "02-203"
- NOT type names like "TYPE A", "A1-As", "2BHK"
- NOT cabinet SKUs like "B24", "W3036"
- NOT room names like "Kitchen", "Bathroom", "Reception", "Restroom"

BUILDING NAME:
- Look for building/tower name in title block, header, or footer
- If no building name found, use null

CRITICAL RULES:
- Extract unit numbers from EVERY page — elevation pages have unit numbers in their title blocks
- On floor plans, extract ALL units visible — scan left to right, top to bottom
- Read EVERY digit carefully — "330" not "33", "1201" not "120"
- Room names like "KITCHEN", "RECEPTION", "RESTROOM", "BATHROOM" are NOT unit types — ignore them as types
- If a room name is the only label, set unitType to ""
- Do NOT skip any page without checking the title block for a unit number

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

    // No longer skip any page type — extract unit numbers from all pages including elevations

    // Filter: unit numbers must look like actual dwelling unit identifiers
    const isValidUnitNumber = (val: string): boolean => {
      const upper = val.toUpperCase();
      // Allow letter-only unit numbers like "A", "B", "C" (single letters or short alpha)
      // But reject known non-unit labels
      if (/^TYPE\s/i.test(upper)) return false;
      if (/^(KITCHEN|BATH|LIVING|BEDROOM|MASTER|DINING|LAUNDRY|PANTRY|CLOSET|RECEPTION|RESTROOM|LOBBY|HALLWAY|CORRIDOR|OFFICE|STORAGE|UTILITY|MECHANICAL)/i.test(upper)) return false;
      if (/^(FLOOR|LEVEL|BUILDING|BLDG|TOWER|WING|BLOCK|EAST|WEST|NORTH|SOUTH)/i.test(upper)) return false;
      if (/^(ELEVATION|ELEV)\b/i.test(upper)) return false;
      if (val.length > 10) return false;
      if (val.length < 1) return false;
      return true;
    };

    // Filter out room names from unitType
    const ROOM_NAMES = /^(KITCHEN|BATH|BATHROOM|LIVING|BEDROOM|MASTER|DINING|LAUNDRY|PANTRY|CLOSET|RECEPTION|RESTROOM|LOBBY|HALLWAY|CORRIDOR|OFFICE|STORAGE|UTILITY|MECHANICAL|FOYER|ENTRY|GARAGE)$/i;

    let units = (parsed.units ?? [])
      .filter((u: any) => u.unitNumber && typeof u.unitNumber === "string")
      .map((u: any) => {
        let unitType = u.unitType ? String(u.unitType).trim() : "";
        // Clear room names mistakenly used as unit types
        if (ROOM_NAMES.test(unitType)) unitType = "";
        // Also clear if it ends with common room suffixes like "RESTROOM-AS"
        if (/^(RESTROOM|RECEPTION|LOBBY|OFFICE|BATHROOM)/i.test(unitType)) unitType = "";
        return {
          unitNumber: String(u.unitNumber).trim(),
          unitType,
          bldg: String(u.bldg || pageBldg || "").trim() || null,
        };
      })
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
