import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `You are an expert millwork estimator reading a page from a 2020 Design shop drawing PDF.

YOUR TASK: Determine the PAGE TYPE and extract data ONLY from FLOOR PLAN pages.

PAGE TYPE IDENTIFICATION:
A FLOOR PLAN page shows a TOP-DOWN / BIRD'S EYE VIEW of a unit layout — you can see:
- Walls, doors, windows drawn from above
- Cabinet boxes shown as rectangles from above (not front view)
- Room labels like "Kitchen", "Bath", "Laundry" placed inside rooms
- A UNIT TYPE name in the title block (e.g. "TYPE A1 - AS", "TYPE C1-2BR", "UNIT TYPE: PH-A")
- Often unit numbers listed (e.g. "UNIT# 230, 330, 430" or "UNITS: 101, 102")

SKIP THESE PAGE TYPES — return {"bldg":null,"units":[]} immediately:
- ELEVATION drawings (front/side view of cabinets showing doors, handles, heights)
- COUNTERTOP drawings (showing countertop outlines, edges, cutouts)
- TITLE/COVER pages with NO drawings (just text and lists)
- Detail/section views, legends, schedules
- Any page that is NOT a top-down floor plan view

*** ONLY extract from FLOOR PLAN (top-down view) pages. Skip ALL other page types. ***

IF THIS IS A FLOOR PLAN PAGE, EXTRACT:

1. UNIT TYPE (most important):
   - Look for prominent text like "TYPE A1 - AS", "UNIT TYPE: A1-3BR", "TYPE C1-2BR", "TYPE PH-A"
   - Usually in a title block, large, bold, or underlined
   - NOT a room name, NOT an elevation label, NOT a sheet number, NOT a cabinet SKU
   - Preserve EXACT text including suffixes like "-AS", "-Mirror", "-Rev", "-3BR"

2. UNIT NUMBERS (CRITICAL — DO NOT MISS ANY):
   - Look for text like "UNIT# 230, 330, 430" or "UNITS: 101, 102, 201, 202"
   - Unit numbers are apartment/suite identifiers (e.g., 230, 101, A-502, PH-1)
   - Usually listed as a COMMA-SEPARATED sequence on the floor plan page
   - COUNT every single number. Read the list CHARACTER BY CHARACTER.
   - Each unit number gets its OWN entry in the output array, all sharing the SAME unit type
   - DOUBLE-CHECK: re-read the comma-separated text and verify your count matches

3. FLOOR DETECTION:
   - Derive from unit number: "230" → floor "2", "101" → floor "1"
   - For 3-digit numbers: first digit is usually the floor
   - If undetermined, use null

4. BUILDING:
   - Look for "BUILDING 1", "BLDG A", etc. If none found, use null

DO NOT EXTRACT:
- Cabinet SKUs (W3030, B24, SB36, HASB48B, HAV3621-REM, etc.)
- Room names (Kitchen, Bath, Island, Pantry, Laundry) as unit numbers
- Elevation labels, sheet numbers, dimensions
- Cabinet or countertop descriptions

VERIFICATION: Before outputting, re-read the unit number list one more time and confirm you captured every number.

Return ONLY valid JSON, no other text:
{"bldg":"Building Name or null","units":[{"unitNumber":"230","unitType":"TYPE A1 - AS","floor":"2"},{"unitNumber":"330","unitType":"TYPE A1 - AS","floor":"3"}]}`;

const VERIFY_PROMPT = `You are verifying extracted unit data from a 2020 Design shop drawing page.

FIRST: Is this a FLOOR PLAN (top-down view) page? If NOT (it's an elevation, countertop drawing, title-only page, or any other non-floor-plan page), return {"bldg":null,"units":[]}.

If it IS a floor plan page, verify:
- Is the UNIT TYPE correct? It should be from the title block (e.g. "TYPE A1 - AS"), NOT a room name.
- Are ALL unit numbers captured? Re-read the comma-separated list CHARACTER BY CHARACTER. Add any missing ones.
- Are there FALSE entries (cabinet SKUs like W3030, HASB48B, room names like "Island")? Remove them.
- ONLY apartment/suite unit numbers should remain (e.g., 230, 101, A-502, PH-1).

Return the corrected JSON (same format), no other text:
{"bldg":"Building Name or null","units":[{"unitNumber":"230","unitType":"TYPE A1 - AS","floor":"2"}]}`;

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
  if (val.length > 12 || val.length < 1) return false;
  if (/^TYPE\s/i.test(val)) return false;

  const compact = val.toUpperCase().replace(/\s+/g, "");
  const compactNoDash = compact.replace(/-/g, "");

  // Must contain at least one digit to be a real unit number
  if (!/\d/.test(compact)) return false;

  // Reject entries starting with ? (garbage from non-title pages)
  if (/^\?/.test(val.trim())) return false;

  // Reject room/space names
  if (/^(KITCHEN|KITCHENETTE|BATH|LIVING|BEDROOM|MASTER|DINING|LAUNDRY|PANTRY|CLOSET|LOBBY|HALLWAY|CORRIDOR|OFFICE|STORAGE|UTILITY|MECHANICAL|FOYER|ENTRY|GARAGE|ISLAND|LOUNGE|RECEPTION|RESTROOM|VANITY|POWDER|STUDIO|COMMON)/i.test(compact)) return false;

  // Reject architectural labels
  if (/^(FLOOR|LEVEL|BUILDING|BLDG|TOWER|WING|BLOCK|EAST|WEST|NORTH|SOUTH)/i.test(compact)) return false;
  if (/^(ELEVATION|ELEV|SECTION|DETAIL|SCALE|SHEET|DWG|REV|DATE|DRAWN|CHECKED|DOOR|WINDOW|SCHEDULE|LEGEND|NOTE|PLAN|TYPICAL)\b/i.test(compact)) return false;

   // Allow building-unit patterns like C1-005, B1-201 (letter(s) + digit + dash/separator + digits)
   const isBuildingUnit = /^[A-Z]{1,2}\d{1}-?\d{2,4}$/i.test(compact);

   // Reject cabinet SKU patterns (including extended 2020 formats like HASB48B, HAV3621-REM)
   if (!isBuildingUnit && /^[A-Z]{1,4}\d{2,4}[A-Z]{0,4}$/i.test(compactNoDash)) return false;
   if (!isBuildingUnit && /^(W|B|SB|DB|UB|UC|TC|TK|WF|BF|V|OH|PT|PTC|UT|HAV|HASB|HASP|HAT|HAF|LS|LSB|FIL|CM|LR|EP|FP)\d/i.test(compactNoDash)) return false;

  // Reject values containing cabinet/room words anywhere
  if (/\b(island|cabinet|base|wall|upper|sink|drawer|countertop|vanity|pantry|lazy|susan|filler|kitchenette)\b/i.test(compact)) return false;

  return true;
}

const ROOM_NAMES = /^(KITCHEN|KITCHENETTE|BATH|BATHROOM|LIVING|BEDROOM|MASTER|DINING|LAUNDRY|PANTRY|CLOSET|LOBBY|HALLWAY|CORRIDOR|OFFICE|STORAGE|UTILITY|MECHANICAL|FOYER|ENTRY|GARAGE|RESTROOM|RECEPTION|ISLAND|COMMON)$/i;

function hasValidUnitType(val: string): boolean {
  const t = String(val || "").trim();
  if (!t) return false;
  if (ROOM_NAMES.test(t)) return false;
  if (/^(FLOOR|LEVEL|ELEVATION|ELEV|PLAN|SECTION|DETAIL|SHEET|COUNTERTOP|CABINET|ISLAND)\b/i.test(t)) return false;
  return true;
}

function cleanUnits(rawUnits: any[], pageBldg: string | null) {
  const units = (rawUnits ?? [])
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
    .filter(u => isValidUnitNumber(u.unitNumber) && hasValidUnitType(u.unitType))
    .filter(u => !/^\d$/.test(u.unitNumber)); // Always reject floor-like single digits (3/4/5 noise)

  // Deduplicate by unit + building + floor (not unit alone), so repeated unit numbers in different areas are preserved
  const seen = new Set<string>();
  const normalizeKeyPart = (v: string | null | undefined) => String(v ?? '').toUpperCase().replace(/\s+/g, '').trim();
  return units.filter(u => {
    const key = `${normalizeKeyPart(u.unitNumber)}|${normalizeKeyPart(u.bldg)}|${normalizeKeyPart(u.floor)}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not configured");
    let model = "gemini-3-pro-preview";

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
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
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
      if (res && !res.ok && res.status === 404 && model !== "gemini-2.5-flash") {
          console.warn(`Model ${model} not available, falling back to gemini-2.5-flash`);
          model = "gemini-2.5-flash";
          if (attempt < MAX_RETRIES - 1) { continue; }
        }
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

    console.log("AI Pass 1 response:", content.slice(0, 500));
    const parsed = extractJSON(content);
    const firstPassUnits = cleanUnits(parsed.units, parsed.bldg || null);
    console.log("Pass 1 units:", firstPassUnits.length, JSON.stringify(firstPassUnits.map(u => u.unitNumber)));

    // PASS 2: Verification — re-send the image with first-pass results for the AI to double-check
    let finalUnits = firstPassUnits;
    try {
      const verifyBody = JSON.stringify({
        contents: [{ role: "user", parts: [
          { inlineData: { mimeType: "image/jpeg", data: pageImage } },
          { text: VERIFY_PROMPT + "\n\nPreviously extracted data:\n" + JSON.stringify({ bldg: parsed.bldg || null, units: firstPassUnits }) },
        ]}],
        generationConfig: { temperature: 0.1, maxOutputTokens: 4096 },
      });

      const verifyRes = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: verifyBody }
      );

      if (verifyRes.ok) {
        const verifyData = await verifyRes.json();
        const verifyContent = verifyData.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
        console.log("AI Pass 2 (verify) response:", verifyContent.slice(0, 500));
        const verifyParsed = extractJSON(verifyContent);
        const verifiedUnits = cleanUnits(verifyParsed.units, verifyParsed.bldg || parsed.bldg || null);

        // Use verified results if they found units (merge to keep the most complete set)
        if (verifiedUnits.length > 0) {
          // Merge: keep all units from both passes, deduplicate by unitNumber
          const merged = new Map<string, typeof finalUnits[0]>();
          for (const u of firstPassUnits) merged.set(u.unitNumber, u);
          for (const u of verifiedUnits) merged.set(u.unitNumber, u); // verified pass overrides
          finalUnits = Array.from(merged.values());
          finalUnits.sort((a, b) => a.unitNumber.localeCompare(b.unitNumber, undefined, { numeric: true }));
        }
        console.log("Pass 2 verified units:", finalUnits.length, JSON.stringify(finalUnits.map(u => u.unitNumber)));
      } else {
        console.warn("Verification pass failed with status:", verifyRes.status, "— using Pass 1 results");
      }
    } catch (verifyErr) {
      console.warn("Verification pass error:", verifyErr, "— using Pass 1 results");
    }

    return new Response(JSON.stringify({ units: finalUnits, pageType: "floor_plan" }), {
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
