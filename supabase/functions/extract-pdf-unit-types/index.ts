import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `You are an expert millwork estimator reading a TITLE PAGE / COVER PAGE of a 2020 Design shop drawing set.

YOUR TASK: Extract the UNIT TYPE and all UNIT NUMBERS listed on this title/cover page.

ABOUT 2020 SHOP DRAWING TITLE PAGES:
- Each shop drawing PDF set has a title/cover page as the first page
- The title page shows: the drawing set title (e.g. "KITCHEN & VANITY CASEWORK SHOP DRAWINGS"), the UNIT TYPE, and a list of UNIT NUMBERS that use this type
- This is the ONLY page you will receive — extract everything from it

WHAT TO EXTRACT:

1. UNIT TYPE (most important):
   - Look for prominent text like "TYPE A1 - AS", "UNIT TYPE: A1-3BR", "TYPE C1-2BR", "TYPE PH-A"
   - It's usually large, bold, centered, or underlined on the page
   - It is NOT a room name (Kitchen, Bath), NOT an elevation label, NOT a sheet number
   - Preserve the EXACT text including suffixes like "-AS", "-Mirror", "-Rev", "-3BR"
   - Examples: "TYPE A1 - AS", "A1-3BR", "C1-2BR", "Studio", "PH-A", "TYPE B2 - MIRROR"

2. UNIT NUMBERS:
   - Look for text like "UNIT# 230, 330, 430" or "UNITS: 101, 102, 201, 202" or "APPLICABLE UNITS: A-101, A-201"
   - Unit numbers are comma-separated apartment/suite identifiers
   - Parse EVERY unit number from the comma-separated list — do NOT miss any
   - Each unit number gets its OWN entry in the output array, all sharing the SAME unit type
   - Examples of unit number formats: "230", "330", "101", "A-502", "PH-1", "1-01", "B204"

3. FLOOR DETECTION:
   - Derive the floor from the unit number pattern: "230" → floor "2", "330" → floor "3", "430" → floor "4"
   - For 3-digit numbers: first digit is usually the floor (101→1, 201→2, 305→3)
   - For 4-digit numbers: first digit(s) before last two are the floor (1201→12, 502→5)
   - For labels like "2ND FLOOR", "LEVEL 3" → use that floor
   - If floor cannot be determined, use null

4. BUILDING:
   - Look for building identifiers like "BUILDING 1", "EAST BUILDING", "BLDG A", "Tower B"
   - If none found, use null

CRITICAL RULES:
- ALL unit numbers from the comma list must appear as separate entries in the output
- Every entry shares the SAME unitType extracted from the page
- Do NOT confuse room names, elevation labels, or SKU codes with unit types
- Read text CHARACTER BY CHARACTER — "A1 - AS" not "A1-A5", "3BR" not "38R"

Return ONLY valid JSON, no other text:
{"bldg":"Building Name or null","units":[{"unitNumber":"230","unitType":"TYPE A1 - AS","floor":"2"},{"unitNumber":"330","unitType":"TYPE A1 - AS","floor":"3"},{"unitNumber":"430","unitType":"TYPE A1 - AS","floor":"4"}]}`;

function extractJSON(text: string): { units: any[]; bldg?: string } {
  // Try markdown fences
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    try { return JSON.parse(fenceMatch[1].trim()); } catch {}
  }

  // Find JSON object with "units"
  const jsonMatches = text.match(/\{[^{}]*"units"\s*:\s*\[[\s\S]*?\]\s*[^{}]*\}/g);
  if (jsonMatches) {
    for (let i = jsonMatches.length - 1; i >= 0; i--) {
      try { return JSON.parse(jsonMatches[i]); } catch {}
    }
  }

  // Try whole text
  try { return JSON.parse(text.trim()); } catch {}

  console.error("JSON extraction failed:", text.slice(0, 500));
  return { units: [] };
}

function isValidUnitNumber(val: string): boolean {
  if (val.length > 10 || val.length < 1) return false;
  if (/^TYPE\s/i.test(val)) return false;
  if (/^(KITCHEN|BATH|LIVING|BEDROOM|MASTER|DINING|LAUNDRY|PANTRY|CLOSET|LOBBY|HALLWAY|CORRIDOR|OFFICE|STORAGE|UTILITY|MECHANICAL|FOYER|ENTRY|GARAGE)/i.test(val)) return false;
  if (/^(FLOOR|LEVEL|BUILDING|BLDG|TOWER|WING|BLOCK|EAST|WEST|NORTH|SOUTH)/i.test(val)) return false;
  if (/^(ELEVATION|ELEV|SECTION|DETAIL|SCALE|SHEET|DWG|REV|DATE|DRAWN|CHECKED|DOOR|WINDOW|SCHEDULE|LEGEND|NOTE|PLAN|TYPICAL)\b/i.test(val)) return false;
  return true;
}

const ROOM_NAMES = /^(KITCHEN|BATH|BATHROOM|LIVING|BEDROOM|MASTER|DINING|LAUNDRY|PANTRY|CLOSET|LOBBY|HALLWAY|CORRIDOR|OFFICE|STORAGE|UTILITY|MECHANICAL|FOYER|ENTRY|GARAGE|RESTROOM|RECEPTION)$/i;

function cleanUnits(rawUnits: any[], pageBldg: string | null) {
  let units = (rawUnits ?? [])
    .filter((u: any) => u.unitNumber && typeof u.unitNumber === "string")
    .map((u: any) => {
      let unitType = u.unitType ? String(u.unitType).trim() : "";
      if (ROOM_NAMES.test(unitType)) unitType = "";
      return {
        unitNumber: String(u.unitNumber).trim(),
        unitType,
        bldg: String(u.bldg || pageBldg || "BLDG 1").trim(),
        floor: u.floor ? `Floor ${String(u.floor).trim().replace(/^Floor\s*/i, '')}` : null,
      };
    })
    .filter(u => isValidUnitNumber(u.unitNumber));

  // Remove single-digit noise only if multi-digit units exist
  const hasMultiDigit = units.some(u => /^\d{2,}$/.test(u.unitNumber));
  if (hasMultiDigit) {
    units = units.filter(u => !/^\d$/.test(u.unitNumber));
  }

  // Deduplicate
  const seen = new Set<string>();
  return units.filter(u => { if (seen.has(u.unitNumber)) return false; seen.add(u.unitNumber); return true; });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not configured");

    const { pageImage } = await req.json();
    if (!pageImage || typeof pageImage !== "string") {
      return new Response(JSON.stringify({ error: "pageImage required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let content = "";
    const MAX_RETRIES = 3;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ role: "user", parts: [
                { inlineData: { mimeType: "image/jpeg", data: pageImage } },
                { text: SYSTEM_PROMPT },
              ]}],
              generationConfig: { temperature: 0.1, maxOutputTokens: 4096 },
            }),
          }
        );
        if (!res.ok) {
          const status = res.status;
          if (status === 429) return new Response(JSON.stringify({ error: "rate_limit" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
          if ((status === 503 || status === 500) && attempt < MAX_RETRIES - 1) { await new Promise(r => setTimeout(r, 3000 * (attempt + 1))); continue; }
          throw new Error(`AI error ${status}`);
        }
        const data = await res.json();
        content = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
        break;
      } catch (err: any) {
        if (attempt === MAX_RETRIES - 1) throw err;
        await new Promise(r => setTimeout(r, 2000));
      }
    }

    console.log("AI response:", content.slice(0, 500));
    const parsed = extractJSON(content);
    const units = cleanUnits(parsed.units, parsed.bldg || null);
    console.log("Extracted units:", units.length, JSON.stringify(units.map(u => u.unitNumber)));

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
