import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

// ── Prompt: optimized for architectural floor plans ──
const MAIN_PROMPT = `You are an expert architectural drafter analyzing a FLOOR PLAN drawing. This is a top-down (bird's-eye) view of one floor of a residential or mixed-use building.

IMPORTANT: You MUST use chain-of-thought. Before producing JSON, describe your analysis step by step.

STEP 1 — IDENTIFY THE PAGE
- Check the TITLE BLOCK (usually bottom-right). It tells you: floor number, building name, project name.
- If this page is a cover sheet, index, detail page, or section with NO units, return: {"units":[],"bldg":null}

STEP 2 — FIND ALL CORRIDORS & HALLWAYS
- Corridors are long, narrow spaces connecting unit entries.
- There may be MULTIPLE corridors on one page (L-shaped, T-shaped, separate wings).
- Stairs, elevators, and trash rooms are along corridors but are NOT units.

STEP 3 — COUNT EVERY UNIT DOOR
- Walk along EVERY corridor. Each door opening into a dwelling space is a unit.
- Unit doors are typically wider than closet/bathroom doors and face the corridor.
- Count the doors. This is your EXPECTED unit count for this page.

STEP 4 — READ UNIT NUMBERS
- Unit numbers appear: AT the door (in the corridor), NEAR the entry inside the unit, on a LABEL/TAG pointing to the unit, or in a SCHEDULE/LEGEND table.
- Common formats: "101", "102", "201", "01-105", "PH-1", "1A", "2B", "A101"
- Read EVERY digit carefully: "330" not "33", "1201" not "120", "01-105" not "1-105"

STEP 5 — READ UNIT TYPES
- Unit type labels are INSIDE the unit boundary, often centered or near the living area.
- Formats: "TYPE A", "TYPE B", "A1", "A1-AS", "B2", "2BR", "Studio", "1BHK"
- A unit type is NOT a room name (Kitchen, Bath, Bedroom).
- If no type label is visible, use empty string "".

STEP 6 — CROSS-CHECK
- Compare your door count (Step 3) with your unit list. They MUST match.
- If you found fewer unit numbers than doors, RE-SCAN the image. Look harder at:
  • Corner units (easy to miss)
  • Units at the END of corridors
  • Units near stairs/elevators
  • Small studio units
  • Units on BOTH SIDES of the corridor
- If a unit schedule/legend exists on the page, extract ALL entries from it.

STEP 7 — OUTPUT
After your analysis, output ONLY the final JSON on its own line:
{"bldg":"Building Name or null","units":[{"unitNumber":"101","unitType":"TYPE A"},{"unitNumber":"102","unitType":""}]}

CRITICAL RULES:
- Extract ALL units. Missing units is the worst possible error.
- Every floor typically has the SAME number of units as other floors.
- Do NOT return room names, cabinet SKUs, or dimension labels as unit numbers.
- Do NOT classify pages — every page is a floor plan. Always try to find units.
- If the page appears to be a cover/index page with a UNIT SCHEDULE listing many units, extract them ALL.`;

const VERIFY_PROMPT = `You previously analyzed this architectural floor plan and found these units: PREV_UNITS

NOW RE-EXAMINE the image carefully. Your job is to find ANY units that were MISSED.

VERIFICATION CHECKLIST:
1. Count every door along every corridor — does the count match the unit list?
2. Check CORNERS of the building — corner units are often missed
3. Check ENDS of corridors — dead-end units are often missed  
4. Check BOTH SIDES of every corridor
5. Check near STAIRS and ELEVATORS — units are often adjacent
6. Check for STUDIO or small units that may not have prominent labels
7. Check if there's a UNIT SCHEDULE or LEGEND table with additional entries
8. Check the TITLE BLOCK for any unit references

If you find additional units, return the COMPLETE list (original + new ones).
If no units were missed, return the same list.

Return ONLY valid JSON:
{"bldg":"Building Name or null","units":[{"unitNumber":"101","unitType":"TYPE A"}]}`;

const FALLBACK_PROMPT = `Look at this architectural drawing page very carefully. Find ALL unit/apartment/suite numbers.

Check these locations:
1. Along corridors/hallways — numbers near doors
2. Inside unit boundaries — labels like "101", "202"  
3. Title block — floor/unit info
4. Any schedule or legend table listing units
5. Any text that looks like a dwelling number (2-5 digits, possibly with prefix like "01-")

Return ONLY valid JSON:
{"bldg":null,"units":[{"unitNumber":"101","unitType":""}]}`;

// ── Helper: call AI model ──
async function callAI(
  pageImage: string,
  promptText: string,
  useDirectGemini: boolean,
  apiKey: string,
  model: string,
  temperature: number,
  maxTokens: number,
): Promise<string> {
  let res: Response;
  if (useDirectGemini) {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [
            { inlineData: { mimeType: "image/jpeg", data: pageImage } },
            { text: promptText },
          ]}],
          generationConfig: { temperature, maxOutputTokens: maxTokens },
        }),
      },
    );
  } else {
    res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        messages: [{ role: "user", content: [
          { type: "image_url", image_url: { url: `data:image/jpeg;base64,${pageImage}` } },
          { type: "text", text: promptText },
        ]}],
        temperature,
        max_tokens: maxTokens,
      }),
    });
  }

  if (!res.ok) {
    const status = res.status;
    const errText = await res.text();
    throw Object.assign(new Error(`AI error ${status}`), { status, body: errText });
  }

  const data = await res.json();
  return useDirectGemini
    ? (data.candidates?.[0]?.content?.parts?.[0]?.text ?? "")
    : (data.choices?.[0]?.message?.content ?? "");
}

// ── Helper: extract JSON from AI text (may contain reasoning before JSON) ──
function extractJSON(text: string): { units: any[]; bldg?: string } {
  // Try markdown fences first
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1].trim()); } catch {}
  }

  // Find the last JSON object containing "units"
  const jsonMatches = text.match(/\{[^{}]*"units"\s*:\s*\[[\s\S]*?\]\s*[^{}]*\}/g);
  if (jsonMatches && jsonMatches.length > 0) {
    // Try the last match first (most likely the final answer after reasoning)
    for (let i = jsonMatches.length - 1; i >= 0; i--) {
      try { return JSON.parse(jsonMatches[i]); } catch {}
    }
  }

  // Try parsing the whole text
  try { return JSON.parse(text.trim()); } catch {}

  // Salvage: find opening brace with "units" and try to close it
  const idx = text.indexOf('"units"');
  if (idx >= 0) {
    let start = text.lastIndexOf('{', idx);
    if (start >= 0) {
      let partial = text.slice(start);
      // Remove trailing incomplete object
      partial = partial.replace(/,\s*\{[^}]*$/, '');
      if (!partial.endsWith(']}')) {
        // Close the units array and main object
        if (!partial.includes(']}')) partial += ']}';
      }
      try { return JSON.parse(partial); } catch {}
    }
  }

  console.error("All JSON extraction methods failed. Content:", text.slice(0, 500));
  return { units: [] };
}

// ── Filter helpers ──
function isValidUnitNumber(val: string): boolean {
  const upper = val.toUpperCase();
  if (/^TYPE\s/i.test(upper)) return false;
  if (/^(KITCHEN|BATH|LIVING|BEDROOM|MASTER|DINING|LAUNDRY|PANTRY|CLOSET|RECEPTION|RESTROOM|LOBBY|HALLWAY|CORRIDOR|OFFICE|STORAGE|UTILITY|MECHANICAL)/i.test(upper)) return false;
  if (/^(FLOOR|LEVEL|BUILDING|BLDG|TOWER|WING|BLOCK|EAST|WEST|NORTH|SOUTH)/i.test(upper)) return false;
  if (/^(ELEVATION|ELEV|SECTION|DETAIL|SCALE|SHEET|DWG|REV|DATE|DRAWN|CHECKED)\b/i.test(upper)) return false;
  if (/^(DOOR|WINDOW|SCHEDULE|LEGEND|NOTE|PLAN|TYPICAL)\b/i.test(upper)) return false;
  if (val.length > 10 || val.length < 1) return false;
  return true;
}

const ROOM_NAMES = /^(KITCHEN|BATH|BATHROOM|LIVING|BEDROOM|MASTER|DINING|LAUNDRY|PANTRY|CLOSET|RECEPTION|RESTROOM|LOBBY|HALLWAY|CORRIDOR|OFFICE|STORAGE|UTILITY|MECHANICAL|FOYER|ENTRY|GARAGE)$/i;

function cleanUnits(rawUnits: any[], pageBldg: string | null): { unitNumber: string; unitType: string; bldg: string | null }[] {
  let units = (rawUnits ?? [])
    .filter((u: any) => u.unitNumber && typeof u.unitNumber === "string")
    .map((u: any) => {
      let unitType = u.unitType ? String(u.unitType).trim() : "";
      if (ROOM_NAMES.test(unitType)) unitType = "";
      if (/^(RESTROOM|RECEPTION|LOBBY|OFFICE|BATHROOM)/i.test(unitType)) unitType = "";
      return {
        unitNumber: String(u.unitNumber).trim(),
        unitType,
        bldg: String(u.bldg || pageBldg || "").trim() || null,
      };
    })
    .filter(u => isValidUnitNumber(u.unitNumber));

  // Remove single-digit noise only if multi-digit units exist
  if (units.length >= 3) {
    const hasMultiDigit = units.some(u => /^\d{2,}$/.test(u.unitNumber));
    if (hasMultiDigit) {
      units = units.filter(u => {
        if (/^\d$/.test(u.unitNumber)) {
          console.log("Filtering out single digit:", u.unitNumber);
          return false;
        }
        return true;
      });
    }
  }

  // Deduplicate by unitNumber
  const seen = new Set<string>();
  units = units.filter(u => {
    if (seen.has(u.unitNumber)) return false;
    seen.add(u.unitNumber);
    return true;
  });

  return units;
}

// ── Main handler ──
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const useDirectGemini = !!GEMINI_API_KEY;
    const apiKey = (useDirectGemini ? GEMINI_API_KEY : LOVABLE_API_KEY)!;
    if (!GEMINI_API_KEY && !LOVABLE_API_KEY) throw new Error("No AI API key configured");

    const { pageImage } = await req.json();

    if (!pageImage || typeof pageImage !== "string") {
      return new Response(JSON.stringify({ error: "pageImage (base64 string) required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const aiModel = useDirectGemini ? "gemini-2.5-pro" : "google/gemini-2.5-pro";

    // ── PASS 1: Main extraction with chain-of-thought ──
    let content = "";
    const MAX_RETRIES = 3;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        content = await callAI(pageImage, MAIN_PROMPT, useDirectGemini, apiKey, aiModel, 0.2, 16384);
        break;
      } catch (err: any) {
        if (err.status === 429) return new Response(JSON.stringify({ error: "rate_limit" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        if (err.status === 402) return new Response(JSON.stringify({ error: "credits" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        if ((err.status === 503 || err.status === 500) && attempt < MAX_RETRIES - 1) {
          console.warn(`AI unavailable (${err.status}), attempt ${attempt + 1}/${MAX_RETRIES}`);
          await new Promise(r => setTimeout(r, 3000 * (attempt + 1)));
          continue;
        }
        if (attempt < MAX_RETRIES - 1) {
          await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
          continue;
        }
        throw err;
      }
    }

    console.log("Pass 1 raw:", content.slice(0, 600));
    let parsed = extractJSON(content);
    let units = cleanUnits(parsed.units, parsed.bldg || null);
    console.log("Pass 1 units:", units.length, JSON.stringify(units.map(u => u.unitNumber)));

    // ── PASS 2: Verification pass if we found some units (but might have missed some) ──
    if (units.length > 0 && units.length <= 20) {
      try {
        const prevList = units.map(u => `${u.unitNumber}${u.unitType ? ` (${u.unitType})` : ""}`).join(", ");
        const verifyPrompt = VERIFY_PROMPT.replace("PREV_UNITS", prevList);
        const verifyContent = await callAI(pageImage, verifyPrompt, useDirectGemini, apiKey, aiModel, 0.2, 8192);
        console.log("Pass 2 raw:", verifyContent.slice(0, 400));
        const verifyParsed = extractJSON(verifyContent);
        const verifyUnits = cleanUnits(verifyParsed.units, verifyParsed.bldg || parsed.bldg || null);
        console.log("Pass 2 units:", verifyUnits.length);

        // Use the larger set (verification should find equal or more)
        if (verifyUnits.length >= units.length) {
          units = verifyUnits;
          console.log("Using Pass 2 results:", units.length, "units");
        }
      } catch (e) {
        console.warn("Verification pass failed, using Pass 1 results:", e);
      }
    }

    // ── PASS 3: Fallback if still 0 units ──
    if (units.length === 0) {
      console.log("No units after Pass 1, trying fallback...");
      try {
        const fbContent = await callAI(pageImage, FALLBACK_PROMPT, useDirectGemini, apiKey, aiModel, 0.3, 4096);
        console.log("Fallback raw:", fbContent.slice(0, 400));
        const fbParsed = extractJSON(fbContent);
        const fbUnits = cleanUnits(fbParsed.units, fbParsed.bldg || null);
        if (fbUnits.length > 0) {
          units = fbUnits;
          console.log("Fallback found", units.length, "units");
        }
      } catch (e) {
        console.warn("Fallback failed:", e);
      }
    }

    console.log("Final validated units:", JSON.stringify(units));

    return new Response(JSON.stringify({ units, pageType: "floor_plan" }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("extract-pdf-unit-types error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
