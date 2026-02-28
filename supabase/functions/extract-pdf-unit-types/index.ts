import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `You are an expert millwork estimator reading a TITLE PAGE / COVER PAGE of a 2020 Design shop drawing set.

YOUR TASK: Extract ONLY the UNIT TYPE and UNIT NUMBERS from this title/cover page. Nothing else.

ABOUT 2020 SHOP DRAWING TITLE PAGES:
- Each shop drawing PDF set has a title/cover page as the first page
- The title page shows: the drawing set title (e.g. "KITCHEN & VANITY CASEWORK SHOP DRAWINGS"), the UNIT TYPE, and a list of UNIT NUMBERS
- This is the ONLY page you will receive — extract everything from it

WHAT TO EXTRACT:

1. UNIT TYPE (most important):
   - Look for prominent text like "TYPE A1 - AS", "UNIT TYPE: A1-3BR", "TYPE C1-2BR", "TYPE PH-A"
   - It's usually large, bold, centered, or underlined on the page
   - It is NOT a room name, NOT an elevation label, NOT a sheet number, NOT a cabinet SKU
   - Preserve the EXACT text including suffixes like "-AS", "-Mirror", "-Rev", "-3BR"
   - Examples: "TYPE A1 - AS", "A1-3BR", "C1-2BR", "Studio", "PH-A", "TYPE B2 - MIRROR"

2. UNIT NUMBERS:
   - Look for text like "UNIT# 230, 330, 430" or "UNITS: 101, 102, 201, 202" or "APPLICABLE UNITS: A-101, A-201"
   - Unit numbers are apartment/suite identifiers (e.g., 230, 101, A-502, PH-1)
   - Parse EVERY unit number from the comma-separated list
   - Each unit number gets its OWN entry in the output array, all sharing the SAME unit type

3. FLOOR DETECTION:
   - Derive the floor from the unit number: "230" → floor "2", "101" → floor "1"
   - For 3-digit numbers: first digit is usually the floor
   - If floor cannot be determined, use null

4. BUILDING:
   - Look for building identifiers like "BUILDING 1", "BLDG A"
   - If none found, use null

CRITICAL — DO NOT EXTRACT THESE:
- Do NOT extract cabinet SKU codes (e.g., W3030, B24, SB36, DB30, W2442, V3021)
- Do NOT extract room names (Kitchen, Bath, Island, Pantry, Laundry, Lounge)
- Do NOT extract cabinet descriptions (e.g., "52 Island", "Island Base", "Wall Cabinet")
- Do NOT extract elevation labels, sheet numbers, or dimensions
- Do NOT extract any text that describes a cabinet, countertop, or fixture
- ONLY extract apartment/suite unit numbers (numeric IDs like 230, 101, A-502)

If the page has NO unit numbers or unit type visible, return {"bldg":null,"units":[]}.

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
  // Reject room/space names
  if (/^(KITCHEN|BATH|LIVING|BEDROOM|MASTER|DINING|LAUNDRY|PANTRY|CLOSET|LOBBY|HALLWAY|CORRIDOR|OFFICE|STORAGE|UTILITY|MECHANICAL|FOYER|ENTRY|GARAGE|ISLAND|LOUNGE|RECEPTION|RESTROOM|VANITY|POWDER)/i.test(val)) return false;
  // Reject architectural labels
  if (/^(FLOOR|LEVEL|BUILDING|BLDG|TOWER|WING|BLOCK|EAST|WEST|NORTH|SOUTH)/i.test(val)) return false;
  if (/^(ELEVATION|ELEV|SECTION|DETAIL|SCALE|SHEET|DWG|REV|DATE|DRAWN|CHECKED|DOOR|WINDOW|SCHEDULE|LEGEND|NOTE|PLAN|TYPICAL)\b/i.test(val)) return false;
  // Reject cabinet SKU patterns (e.g., W3030, B24, SB36, DB30, V3021)
  if (/^[A-Z]{1,3}\d{2,4}[A-Z]?$/i.test(val)) return false;
  // Reject values containing cabinet/room words anywhere
  if (/\b(island|cabinet|base|wall|upper|sink|drawer|countertop|vanity|pantry|lazy|susan|filler)\b/i.test(val)) return false;
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
