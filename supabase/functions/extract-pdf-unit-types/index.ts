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

    const prompt = `You are reading an ARCHITECTURAL FLOOR PLAN page. This shows a top-down view of a building floor with multiple residential/commercial units.

YOUR TASK: Find EVERY unit number and unit type on this page. Missing even one unit is unacceptable.

HOW TO READ AN ARCHITECTURAL FLOOR PLAN:
- The page shows walls, doors, rooms, corridors, stairs, and elevators from a TOP-DOWN (bird's eye) view
- Each dwelling unit is a bounded area with rooms inside (kitchen, bedroom, living, bathroom)
- Multiple units appear on each page, typically 4-12 per floor

WHERE UNIT NUMBERS ARE LOCATED:
1. AT THE DOOR/ENTRY — unit numbers are placed at or near the entry door, facing the corridor/hallway
2. AT THE EDGE of the unit boundary — small text along the perimeter
3. IN THE CORRIDOR — numbers visible in the hallway area near each unit's door
4. Sometimes inside the unit near the entry

WHERE UNIT TYPES ARE LOCATED:
1. INSIDE the unit — centered or near a major room label (e.g. "Type A", "Unit A", "2BR-A", "A1-AS")
2. In a LEGEND or SCHEDULE table on the page
3. In the TITLE BLOCK — sometimes lists the floor and unit types

WHAT IS A UNIT NUMBER:
- Dwelling identifiers: "101", "102", "201", "305", "01-105", "PH-1", "1A", "2B"
- Usually 2-5 characters, mostly numeric
- NOT: cabinet SKUs (B24, W3036), room names (Kitchen, Bath), type names (TYPE A)

WHAT IS A UNIT TYPE:  
- Type designation: "TYPE A", "TYPE B", "Unit A", "2BHK", "Studio", "1BR", "A1-AS"
- If not found, use empty string ""

BUILDING NAME: Look in title block. If not found, use null.

SYSTEMATIC SCAN PROCESS:
1. Identify ALL corridors/hallways on the page
2. Walk along each corridor and find every door — each door leads to a unit
3. Read the unit number at each door
4. Look inside each unit for the type label
5. Cross-check: count the unit outlines vs unit numbers found. If mismatch, look harder.
6. Check the title block for floor number and building name

CRITICAL RULES:
- Extract ALL units — every door in the corridor has a unit number
- Each floor typically has the SAME number of units — if Floor 2 had 8 units, Floor 3 should too
- Read every digit carefully — "330" not "33", "1201" not "120"
- Do NOT skip any unit — check every corridor on the page
- If you see a schedule/legend, extract ALL entries from it

Return ONLY valid JSON, no markdown:
{"pageType":"floor_plan","bldg":"Building A","units":[{"unitNumber":"101","unitType":"TYPE A"},{"unitNumber":"102","unitType":"TYPE B"}]}`;

    const fallbackPrompt = `This is an architectural floor plan. Look at ALL the doors along the corridors/hallways. Each door has a unit number nearby (like "101", "202", "01-105").

List EVERY unit number you can find on this page. Also check the title block at the bottom for building name and floor info.

Return ONLY valid JSON:
{"pageType":"floor_plan","bldg":null,"units":[{"unitNumber":"101","unitType":""},{"unitNumber":"102","unitType":""}]}`;

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

    const pageType = parsed.pageType || "floor_plan";
    const pageBldg = parsed.bldg || null;
    console.log("Page type:", pageType, "Bldg:", pageBldg, "Units found:", (parsed.units ?? []).length);

    // If AI returned 0 units, retry with a simpler fallback prompt focused on title block
    if ((parsed.units ?? []).length === 0) {
      console.log("No units found, retrying with fallback prompt...");
      let fallbackRes: Response | null = null;
      try {
        if (useDirectGemini) {
          fallbackRes = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${aiModel}:generateContent?key=${GEMINI_API_KEY}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                contents: [{ role: "user", parts: [
                  { inlineData: { mimeType: "image/jpeg", data: pageImage } },
                  { text: fallbackPrompt },
                ]}],
                generationConfig: { temperature: 0.2, maxOutputTokens: 4096 },
              }),
            }
          );
        } else {
          fallbackRes = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: { Authorization: `Bearer ${LOVABLE_API_KEY}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model: aiModel,
              messages: [{ role: "user", content: [
                { type: "image_url", image_url: { url: `data:image/jpeg;base64,${pageImage}` } },
                { type: "text", text: fallbackPrompt },
              ]}],
              temperature: 0.2, max_tokens: 4096,
            }),
          });
        }
        if (fallbackRes && fallbackRes.ok) {
          const fbData = await fallbackRes.json();
          const fbContent: string = useDirectGemini
            ? (fbData.candidates?.[0]?.content?.parts?.[0]?.text ?? "")
            : (fbData.choices?.[0]?.message?.content ?? "");
          console.log("Fallback AI response:", fbContent.slice(0, 400));
          let fbCleaned = fbContent.trim();
          const fbFence = fbCleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
          if (fbFence) fbCleaned = fbFence[1].trim();
          try {
            const fbParsed = JSON.parse(fbCleaned);
            if ((fbParsed.units ?? []).length > 0) {
              parsed = fbParsed;
              console.log("Fallback found", parsed.units.length, "units");
            }
          } catch { console.error("Fallback JSON parse failed"); }
        }
      } catch (e) { console.error("Fallback retry failed:", e); }
    }

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
