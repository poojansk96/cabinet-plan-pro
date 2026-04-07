import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `You are an expert millwork estimator reading a page from a 2020 Design shop drawing PDF.

YOUR TASK: Extract ALL unit / room identifiers from this page. Every page the user uploads is intentional — NEVER skip a page.

ACCEPT ALL PAGE TYPES — any page that shows a space with cabinets or millwork is valid:
- Standard apartment floor plans (top-down view)
- Common area plans: restroom, laundry, mail room, office, community room, package room, janitor closet, etc.
- Elevation drawings that reference a unit/room
- Enlarged unit plans, detail plans
- ANY page that contains a unit number or room identifier

ONLY return {"bldg":null,"units":[]} if the page is truly a cover/title page with NO unit or room references at all.

EXTRACT:

1. UNIT TYPE (most important — NEVER leave null or empty):
   - Prefer the title-block type when present (e.g. "TYPE A1 - AS", "UNIT TYPE: A1-3BR", "TYPE C1-2BR", "TYPE PH-A")
   - For COMMON AREA spaces (restroom, office, laundry, mail room, community room, package room, janitor closet, trash room, etc.), use the ROOM LABEL as the unitType (e.g. "Restroom", "Office", "Laundry", "Mail Room")
   - If you cannot find ANY type label, use the room/space name visible on the plan as unitType
   - Preserve EXACT text including suffixes like "-AS", "-Mirror", "-Rev", "-3BR"
   - KEEP the FULL type name exactly as written, including bedroom-count prefixes like "1BR", "2BR", "3BR", "STUDIO". Example: "2BR TYPE B1" → "2BR TYPE B1", "STUDIO TYPE S1" → "STUDIO TYPE S1", "3BR TYPE C-MIRROR" → "3BR TYPE C-MIRROR"
   - CRITICAL: Preserve trailing digits! "TYPE B1" and "TYPE B" are DIFFERENT types. "TYPE A1" and "TYPE A" are DIFFERENT. Read each character carefully — do NOT truncate trailing numbers.
   - CRITICAL: Every distinct type label on the page MUST appear in the output. Do NOT merge or skip types that look similar. "TYPE B", "TYPE B1", "TYPE B-AS", "TYPE B-MIRROR" are ALL separate types.
   - CRITICAL: unitType can NEVER be a building label or the same text as unitNumber. Example: if the page says "BLDG 13 / UNIT 13C" and the room label is "Kitchenette", then unitType = "Kitchenette" and unitNumber = "13C".
   - Never use sheet numbers, dimensions, cabinet SKUs, or drawing labels as unitType

2. UNIT NUMBERS (CRITICAL — DO NOT MISS ANY):
   - Look for text like "UNIT# 230, 330, 430" or "UNITS: 101, 102, 201, 202"
   - Unit numbers are apartment/suite identifiers (e.g., 230, 101, A-502, PH-1)
   - For common areas that don't have an explicit unit number but have a room number (e.g., "103", "110"), use that room number as the unitNumber
   - If a common area page has NO unit/room number at all, use "1" as unitNumber so the entry is not lost
   - Usually listed as a COMMA-SEPARATED sequence on the floor plan page
   - COUNT every single number. Read the list CHARACTER BY CHARACTER.
   - Each unit number gets its OWN entry in the output array, all sharing the SAME unit type
   - DOUBLE-CHECK: re-read the comma-separated text and verify your count matches

3. FLOOR DETECTION:
   - Derive from unit number: "230" → floor "2", "101" → floor "1"
   - For 3-digit numbers: first digit is usually the floor
   - If undetermined, use null

4. BUILDING (CRITICAL — MULTI-BUILDING PAGES):
   - Look for "BUILDING 1", "BLDG A", "BLDG 1, BLDG 3", etc.
   - **IMPORTANT**: A single page often lists MULTIPLE buildings that share the SAME unit layout.
     For example: "BLDG 1, BLDG 3 — UNIT# 1A, 2A" means FOUR entries:
       BLDG 1 / 1A, BLDG 1 / 2A, BLDG 3 / 1A, BLDG 3 / 2A
   - You MUST create a SEPARATE entry for EACH building × EACH unit number combination.
   - Include the building in the "bldg" field of EACH unit entry (e.g., "BLDG 1", "BLDG 3").
   - If buildings are listed like "BLDG 2, BLDG 4, BLDG 6", create entries for ALL three buildings.
   - **IMPORTANT**: Use ONLY the structured building label (e.g., "BLDG 1", "Building A"). Do NOT use the project/apartment name (e.g., "Clover Apartments", "Sunrise Towers") as a building value.
   - If no structured building label is found, use null.

DO NOT EXTRACT:
- Cabinet SKUs (W3030, B24, SB36, HASB48B, HAV3621-REM, etc.)
- Room names (Kitchen, Bath, Island, Pantry) as unit numbers — but DO use them as unitType for common areas
- Elevation labels, sheet numbers, dimensions
- Cabinet or countertop descriptions
- DETAIL CALLOUT ADDRESSES — these are references like "B1-A/403", "A/101", "2/A301" where the format is "detail-name/sheet-number". They reference other drawing sheets and are NOT unit numbers. Any value containing a "/" is almost certainly a callout address.

VERIFICATION: Before outputting, re-read the unit number list one more time and confirm you captured every number.

Return ONLY valid JSON, no other text. Each unit entry MUST include a "bldg" field:
{"bldg":null,"units":[{"unitNumber":"1A","unitType":"TYPE 1 - AS","floor":"1","bldg":"BLDG 1"},{"unitNumber":"1A","unitType":"TYPE 1 - AS","floor":"1","bldg":"BLDG 3"},{"unitNumber":"2A","unitType":"TYPE 1 - AS","floor":"2","bldg":"BLDG 1"},{"unitNumber":"2A","unitType":"TYPE 1 - AS","floor":"2","bldg":"BLDG 3"}]}`;

const COMMON_AREA_LABELS: Array<{ label: string; re: RegExp }> = [
  { label: "Kitchenette", re: /\bKITCHENETTE\b/i },
  { label: "Mail Room", re: /\bMAIL\s*ROOM\b/i },
  { label: "Break Room", re: /\bBREAK\s*ROOM\b/i },
  { label: "Business Center", re: /\bBUSINESS\s*CENTER\b/i },
  { label: "Community Room", re: /\bCOMMUNITY\s*ROOM\b/i },
  { label: "Pool Bath", re: /\bPOOL\s*BATH\b/i },
  { label: "Leasing", re: /\bLEASING\b/i },
  { label: "Clubhouse", re: /\bCLUBHOUSE\b/i },
  { label: "Fitness", re: /\bFITNESS\b/i },
  { label: "Laundry", re: /\bLAUNDRY\b/i },
  { label: "Restroom", re: /\bRESTROOM\b/i },
  { label: "Lobby", re: /\bLOBBY\b/i },
  { label: "Office", re: /\bOFFICE\b/i },
  { label: "Reception", re: /\bRECEPTION\b/i },
  { label: "Storage", re: /\bSTORAGE\b/i },
  { label: "Garage", re: /\bGARAGE\b/i },
  { label: "Corridor", re: /\bCORRIDOR\b/i },
  { label: "Mechanical", re: /\bMECHANICAL\b/i },
  { label: "Maintenance", re: /\bMAINTENANCE\b/i },
  { label: "Trash", re: /\bTRASH\b/i },
];

function normalizeTypeText(value: string): string {
  return String(value || "")
    .replace(/[\u2010-\u2015]/g, "-")
    .replace(/\u00A0/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\s*-\s*/g, "-")
    .replace(/\s*\(\s*/g, " (")
    .replace(/\s*\)\s*/g, ")")
    .trim();
}

function detectCommonAreaLabel(value: string): string | null {
  for (const entry of COMMON_AREA_LABELS) {
    if (entry.re.test(value)) return entry.label;
  }
  return null;
}

function normalizeResolvedUnitType(value: string): string {
  const clean = normalizeTypeText(value);
  if (!clean) return "";
  if (/^(?:PLAN|ELEVATION|SECTION|DETAIL|SHEET|DRAWING|LEGEND)\b/i.test(clean)) return "";
  const commonArea = detectCommonAreaLabel(clean);
  if (commonArea) return commonArea;
  return clean.toUpperCase();
}

function hasStrongTypeStructure(value: string): boolean {
  const t = normalizeResolvedUnitType(value).toUpperCase();
  if (!t) return false;
  return /^TYPE\b/.test(t)
    || /\b(?:MIRROR|ADA|REV|AS|BR|BED|PH|STUDIO|KITCHENETTE|LAUNDRY|MAIL\s*ROOM|RESTROOM|OFFICE|RECEPTION)\b/.test(t)
    || /(?:^|[-\s])(?:AS|MIRROR|ADA|REV|ALT|OPTION)\b/.test(t);
}

function trimPageText(value: string, limit = 12000): string {
  const text = normalizeTypeText(value);
  return text.length > limit ? text.slice(0, limit) : text;
}

function isSuspiciousUnitType(value: string, unitNumber = ""): boolean {
  const text = normalizeResolvedUnitType(value);
  const normalizedUnit = normalizeTypeText(unitNumber).toUpperCase();
  if (!text) return true;
  if (normalizedUnit && text.toUpperCase() === normalizedUnit) return true;
  if (hasStrongTypeStructure(text)) return false;
  if (/^(?:BLDG|BUILDING|FLOOR|LEVEL|UNIT)\b/i.test(text)) return true;
  return /^[A-Z]?\d{1,4}[A-Z]?(?:-\d{1,4}[A-Z]?)?$/.test(text.toUpperCase().replace(/\s+/g, ""));
}

function canonicalTypeBase(value: string): string {
  const text = normalizeResolvedUnitType(value).toUpperCase();
  if (!text) return "";
  const commonArea = detectCommonAreaLabel(text);
  if (commonArea) return commonArea.toUpperCase().replace(/\s+/g, "");
  return text
    .replace(/\s+\((AS|MIRROR|ADA|REV|ALT|OPTION)\)$/g, "")
    .replace(/-(AS|MIRROR|ADA|REV|ALT|OPTION)\b/g, "")
    .replace(/^TYPE\s+/, "")
    .replace(/\s+/g, "")
    .trim();
}

function typeSpecificityScore(value: string): number {
  const text = normalizeResolvedUnitType(value).toUpperCase();
  if (!text) return 0;
  let score = text.replace(/\s+/g, "").length;
  if (/\bTYPE\b/.test(text)) score += 25;
  if (/\b(?:STUDIO|\d+BR)\b/.test(text)) score += 20;
  if (/(?:^|[-\s])(?:AS|MIRROR|ADA|REV|ALT|OPTION)\b/.test(text)) score += 30;
  if (/\(|\)|\./.test(text)) score += 10;
  if (detectCommonAreaLabel(text)) score += 30;
  return score;
}

function extractTypeFromPageText(pageText: string): string | null {
  const text = trimPageText(pageText).replace(/[|]+/g, " ");
  if (!text) return null;

  const patterns = [
    /\b(?:STUDIO|\d+\s*BR)\s+TYPE\s+[A-Z0-9][A-Z0-9._]*(?:\s*-\s*[A-Z0-9._]+)*(?:\s+\([A-Z0-9 ._-]+\))?/i,
    /\bTYPE\s+[A-Z0-9][A-Z0-9._]*(?:\s*-\s*[A-Z0-9._]+)*(?:\s+\([A-Z0-9 ._-]+\))?/i,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern)?.[0];
    if (!match) continue;
    const resolved = normalizeResolvedUnitType(match);
    if (resolved && !isSuspiciousUnitType(resolved)) return resolved;
  }

  return detectCommonAreaLabel(text);
}

function pickPreferredUnitType(aiType: string, pageText: string, unitNumber = ""): string {
  const resolvedAi = normalizeResolvedUnitType(aiType);
  const resolvedFromText = extractTypeFromPageText(pageText) || "";
  if (!resolvedAi) return resolvedFromText;
  if (!resolvedFromText) return resolvedAi;
  if (isSuspiciousUnitType(resolvedAi, unitNumber)) return resolvedFromText;

  const aiBase = canonicalTypeBase(resolvedAi);
  const textBase = canonicalTypeBase(resolvedFromText);
  if (aiBase && textBase && aiBase === textBase && typeSpecificityScore(resolvedFromText) > typeSpecificityScore(resolvedAi)) {
    return resolvedFromText;
  }

  return resolvedAi;
}

function extractJSON(text: string): { units: any[]; bldg?: string } {
  // Strip markdown fences
  let cleaned = text.trim();
  const fenceMatch = cleaned.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) cleaned = fenceMatch[1].trim();

  // Try direct parse
  try { return JSON.parse(cleaned); } catch {}

  // Find JSON object with "units" array
  const jsonMatches = cleaned.match(/\{[^{}]*"units"\s*:\s*\[[\s\S]*?\]\s*[^{}]*\}/g);
  if (jsonMatches) {
    for (let i = jsonMatches.length - 1; i >= 0; i--) {
      try { return JSON.parse(jsonMatches[i]); } catch {}
    }
  }

  // TRUNCATED JSON RECOVERY: If the response was cut off mid-JSON,
  // extract individual unit objects from the incomplete array
  const unitObjPattern = /\{\s*"unitNumber"\s*:\s*"([^"]+)"\s*,\s*"unitType"\s*:\s*"([^"]+)"\s*,\s*"floor"\s*:\s*"?([^",}]*)"?\s*,\s*"bldg"\s*:\s*"([^"]*)"\s*\}/g;
  const units: any[] = [];
  let m;
  while ((m = unitObjPattern.exec(cleaned)) !== null) {
    units.push({ unitNumber: m[1], unitType: m[2], floor: m[3] || null, bldg: m[4] });
  }
  if (units.length > 0) {
    // Try to extract top-level bldg
    const bldgMatch = cleaned.match(/"bldg"\s*:\s*"([^"]+)"/);
    console.log(`Recovered ${units.length} units from truncated JSON`);
    return { units, bldg: bldgMatch?.[1] };
  }

  console.error("JSON extraction failed:", cleaned.slice(0, 500));
  return { units: [] };
}

function normalizeUnitNumber(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .replace(/^UNIT\s*(NO\.?|NUMBER|#)?\s*[:\-]?\s*/i, "")
    .replace(/^APT\.?\s*/i, "")
    .replace(/^SUITE\s*/i, "")
    .replace(/^[#\s]+/, "")
    .replace(/[.,;:]$/, "")
    .trim();
}

function hasStrongTypeHint(unitType: string): boolean {
  const t = String(unitType || "").trim().toUpperCase();
  if (!t) return false;
  return /^TYPE\b/.test(t) || /\b(MIRROR|ADA|REV|AS|BR|BED|PH|STUDIO|KITCHENETTE|LAUNDRY|MAIL\s*ROOM|RESTROOM|OFFICE|RECEPTION)\b/.test(t);
}

function isValidUnitNumber(val: string, unitType = ""): boolean {
  if (val.length > 12 || val.length < 1) return false;
  if (/^TYPE\s/i.test(val)) return false;

  const compact = val.toUpperCase().replace(/\s+/g, "");
  const compactNoDash = compact.replace(/-/g, "");

  // Reject entries starting with ? (garbage from non-title pages)
  if (/^\?/.test(val.trim())) return false;

  // Reject detail callout addresses containing "/" (e.g. "B1-A/403", "A/101", "2/A301")
  if (/\//.test(val.trim())) return false;

  // Reject architectural labels (but NOT room names - those are valid for common areas)
  if (/^(FLOOR|LEVEL|BUILDING|BLDG|TOWER|WING|BLOCK|EAST|WEST|NORTH|SOUTH)/i.test(compact)) return false;
  if (/^(ELEVATION|ELEV|SECTION|DETAIL|SCALE|SHEET|DWG|REV|DATE|DRAWN|CHECKED|DOOR|WINDOW|SCHEDULE|LEGEND|NOTE|PLAN|TYPICAL)\b/i.test(compact)) return false;

   // Allow building-unit patterns like C1-005, B1-201 (letter(s) + digit + dash/separator + digits)
   const isBuildingUnit = /^[A-Z]{1,2}\d{1}-?\d{2,4}$/i.test(compact);

   // Reject cabinet SKU patterns (including extended 2020 formats like HASB48B, HAV3621-REM)
   if (!isBuildingUnit && /^[A-Z]{1,4}\d{2,4}[A-Z]{0,4}$/i.test(compactNoDash)) return false;
   if (!isBuildingUnit && /^(W|B|SB|DB|UB|UC|TC|TK|WF|BF|V|OH|PT|PTC|UT|HAV|HASB|HASP|HAT|HAF|LS|LSB|FIL|CM|LR|EP|FP)\d/i.test(compactNoDash)) return false;

  // Reject values containing cabinet-specific words (but allow room names)
  if (/\b(cabinet|base|wall|upper|sink|drawer|countertop|vanity|lazy|susan|filler)\b/i.test(compact)) return false;

  // Support projects where unit IDs are letter-only (A/B/C) but only with strong type context
  if (!/\d/.test(compact)) {
    const isShortAlphaUnit = /^[A-Z]{1,2}$/.test(compactNoDash);
    if (!(isShortAlphaUnit && hasStrongTypeHint(unitType))) return false;
  }

  return true;
}

/** Normalize building string to a canonical key for dedup */
function normalizeBldgKey(raw: string): string {
  return String(raw || '').toUpperCase().trim()
    .replace(/BUILDINGS?/g, 'BLDG')
    .replace(/BLDG\.?/g, 'BLDG')
    .replace(/[^A-Z0-9]/g, '');
}

/** Check if a building label is a proper structural label (BLDG 1, Tower A, etc.) vs a project name */
function isStructuredBldg(key: string): boolean {
  return /(BLDG|TOWER|WING|BLOCK|PHASE|PODIUM)/.test(key) || /\d/.test(key);
}

/** Split a bldg string like "BLDG 7, 10, 11" into ["BLDG 7", "BLDG 10", "BLDG 11"] */
function splitMultiBuilding(bldgStr: string): string[] {
  const s = bldgStr.trim();
  if (!s) return [''];
  // Match patterns like "BLDG 7, 10, 11" or "BLDG 7, BLDG 10, BLDG 11"
  const prefixMatch = s.match(/^(BLDG|BUILDING|TOWER|WING|BLOCK|PHASE)\s*/i);
  if (!prefixMatch) return [s]; // no known prefix, return as-is
  const prefix = prefixMatch[0].trim();
  const rest = s.slice(prefixMatch[0].length);
  // Split by comma
  const parts = rest.split(/\s*,\s*/).map(p => p.trim()).filter(Boolean);
  if (parts.length <= 1) return [s]; // single building, return as-is
  // Check if parts are just numbers/short IDs (e.g., "7, 10, 11") — indicates multi-bldg in one field
  const expanded = parts.map(p => {
    // If the part already has a prefix (e.g., "BLDG 10"), use it directly
    if (/^(BLDG|BUILDING|TOWER|WING|BLOCK|PHASE)\s/i.test(p)) return p;
    // Otherwise, prepend the detected prefix
    return `${prefix} ${p}`;
  });
  return expanded;
}

function cleanUnits(rawUnits: any[], pageBldg: string | null, pageText = "") {
  const pageTypeHint = extractTypeFromPageText(pageText) || "";
  const mapped = (rawUnits ?? [])
    .filter((u: any) => u.unitNumber && typeof u.unitNumber === "string")
    .map((u: any) => {
      const normalizedUnitNumber = normalizeUnitNumber(u.unitNumber);
      let unitType = normalizeResolvedUnitType(u.unitType ? String(u.unitType).trim() : "");
      // Preserve full type name including bedroom prefixes
      if (/^(FLOOR|LEVEL|ELEVATION|ELEV|PLAN|SECTION|DETAIL|SHEET|DRAWING|DWG|REV|DATE|SCALE|NOTE|LEGEND)\b/i.test(unitType)) unitType = "";
      if (/^(W|B|SB|DB|UB|UC|TC|TK|WF|BF|V|OH|PT|PTC|UT|HAV|HASB|HASP|HAT|HAF|LS|LSB|FIL|CM|LR|EP|FP)\d/i.test(unitType.replace(/\s+/g, '').toUpperCase())) unitType = "";
      unitType = pickPreferredUnitType(unitType, pageTypeHint, normalizedUnitNumber);
      return {
        unitNumber: normalizedUnitNumber,
        unitType,
        bldg: String(u.bldg || pageBldg || "").trim(),
        floor: u.floor ? `Floor ${String(u.floor).trim().replace(/^Floor\s*/i, '')}` : null,
      };
    })
    .filter(u => isValidUnitNumber(u.unitNumber, u.unitType));

  // Expand entries where bldg contains multiple buildings (e.g., "BLDG 7, 10, 11")
  const units: typeof mapped = [];
  for (const u of mapped) {
    const bldgs = splitMultiBuilding(u.bldg);
    if (bldgs.length > 1) {
      console.log(`Splitting multi-building "${u.bldg}" into ${bldgs.length} entries for unit ${u.unitNumber}`);
    }
    for (const b of bldgs) {
      units.push({ ...u, bldg: b });
    }
  }

  // Find the dominant structured building label on this page
  const bldgCounts = new Map<string, { count: number; label: string }>();
  for (const u of units) {
    const key = normalizeBldgKey(u.bldg);
    if (!key) continue;
    const existing = bldgCounts.get(key);
    if (existing) { existing.count++; } else { bldgCounts.set(key, { count: 1, label: u.bldg }); }
  }
  // Pick the structured label with most occurrences
  let dominantKey = '';
  let dominantLabel = '';
  let dominantCount = 0;
  for (const [key, val] of bldgCounts) {
    if (isStructuredBldg(key) && val.count > dominantCount) {
      dominantKey = key;
      dominantLabel = val.label;
      dominantCount = val.count;
    }
  }

  // If no structured building label found on this page, default to "BLDG 1"
  if (!dominantKey) {
    dominantLabel = 'BLDG 1';
  }

  // Normalize: fold non-structured building names (project names like "Clover Apartments") into the dominant structured label
  const normalized = units.map(u => {
    const key = normalizeBldgKey(u.bldg);
    if (!key || !isStructuredBldg(key)) {
      return { ...u, bldg: dominantLabel };
    }
    return u;
  });

  // Deduplicate by unitNumber + normalized bldg + unitType
  const seen = new Set<string>();
  const kp = (v: string | null | undefined) => String(v ?? '').toUpperCase().replace(/\s+/g, '').trim();
  return normalized.filter(u => {
    const key = `${kp(u.unitNumber)}|${kp(u.bldg)}|${kp(u.unitType)}`;
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

    const { pageImage, pageText = "", speedMode } = await req.json();
    const isFastMode = speedMode === 'fast';
    const pageTextSnippet = trimPageText(String(pageText || ""));
    if (!pageImage || typeof pageImage !== "string") {
      return new Response(JSON.stringify({ error: "pageImage required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    let content = "";
    const MODELS = ["gemini-3.1-flash-lite", "gemini-3-flash"];
    const MAX_RETRIES = 3;

    for (const model of MODELS) {
      let modelSucceeded = false;
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          console.log(`Pass 1 trying ${model}, attempt ${attempt + 1}/${MAX_RETRIES}`);
          const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_API_KEY}`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                contents: [{ role: "user", parts: [
                  { inlineData: { mimeType: "image/jpeg", data: pageImage } },
                  { text: SYSTEM_PROMPT },
                  ...(pageTextSnippet ? [{ text: `PDF TEXT LAYER (use this exact text to resolve unitType when visible):\n${pageTextSnippet}` }] : []),
                ]}],
              generationConfig: { temperature: 0.1, maxOutputTokens: 8192 },
              }),
            }
          );
          if (!res.ok) {
            const status = res.status;
            if (status === 429 && attempt < MAX_RETRIES - 1) { console.warn(`Rate limited (429) on ${model}, attempt ${attempt + 1}/${MAX_RETRIES}`); await new Promise(r => setTimeout(r, 8000 * (attempt + 1))); continue; }
            if (status === 429) return new Response(JSON.stringify({ error: "rate_limit" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
            if (status === 402) return new Response(JSON.stringify({ error: "credits" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
            if ((status === 503 || status === 500) && attempt < MAX_RETRIES - 1) { await new Promise(r => setTimeout(r, 3000 * (attempt + 1))); continue; }
            if (status === 503 || status === 500) {
              console.warn(`${model} unavailable (${status}) after ${MAX_RETRIES} attempts, trying next model`);
              break; // break inner loop to try next model
            }
            throw new Error(`AI error ${status}`);
          }
          const data = await res.json();
          content = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
          modelSucceeded = true;
          break;
        } catch (err: any) {
          if (attempt === MAX_RETRIES - 1) {
            console.warn(`${model} failed after ${MAX_RETRIES} attempts: ${err.message}, trying next model`);
            break; // try next model
          }
          await new Promise(r => setTimeout(r, 2000));
        }
      }
      if (modelSucceeded) break;
    }

    // If no model succeeded at all
    if (!content) {
      console.error("All models failed for Pass 1");
      return new Response(JSON.stringify({ units: [], pageType: "skipped" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("AI Pass 1 response:", content.slice(0, 500));
    const parsed = extractJSON(content);
    const firstPassUnits = cleanUnits(parsed.units, parsed.bldg || null, pageTextSnippet);
    console.log("Pass 1 units:", firstPassUnits.length, JSON.stringify(firstPassUnits.map(u => `${u.bldg}/${u.unitNumber}`)));

    // PASS 2: Verification — re-send the image with first-pass results (SKIP in fast mode)
    let finalUnits = firstPassUnits;
    if (!isFastMode) {
      try {
        const VERIFY_PROMPT = `You are verifying extracted unit data from a 2020 Design shop drawing page.

This page may show ANY type of drawing that contains cabinet/millwork information:
- Standard apartment floor plans (top-down view)
- Common area plans (restroom, laundry, mail room, office, community room, package room, etc.)
- Enlarged unit plans
- Plan view drawings of ANY space

**CRITICAL**: If Pass 1 found valid units, do NOT return an empty list unless you are 100% certain the page contains NO unit/room identifiers at all. Common areas with unit numbers (e.g., "103", "110", "115") are VALID entries.

**IMPORTANT**: Do NOT reject a page just because it shows a single room (restroom, laundry, mail room). These are valid units that need cabinets.

        Verify:
- Is the UNIT TYPE correct? Prefer title-block unit type when present; for common areas (restroom, office, laundry, mail room, community room, package room), use the ROOM LABEL as unitType.
        - CRITICAL: unitType must never be the same as unitNumber or building label. If the page says "BLDG 13 / UNIT 13C" and the room is "Kitchenette", the correct unitType is "Kitchenette", not "13C".
- Are ALL unit numbers captured? Re-read the comma-separated list CHARACTER BY CHARACTER. Add any missing ones.
- Are there FALSE entries (cabinet SKUs like W3030, HASB48B, room names like "Island")? Remove them.
- ONLY apartment/suite unit numbers or common area room numbers should remain (e.g., 230, 101, A-502, PH-1, 103, 110).
- **CRITICAL**: If the page lists MULTIPLE BUILDINGS (e.g., "BLDG 1, BLDG 3"), EACH unit number must appear ONCE PER BUILDING with the correct "bldg" field.
- **IMPORTANT**: Use ONLY the structured building label (e.g., "BLDG 1", "Building A"). Do NOT use the project/apartment name as a building value.
- Check if any buildings were missed.

Return the corrected JSON (same format), no other text. Each entry MUST have a "bldg" field:
{"bldg":null,"units":[{"unitNumber":"1A","unitType":"TYPE 1 - AS","floor":"1","bldg":"BLDG 1"}]}`;

        const verifyBody = JSON.stringify({
          contents: [{ role: "user", parts: [
            { inlineData: { mimeType: "image/jpeg", data: pageImage } },
            { text: VERIFY_PROMPT + "\n\nPDF TEXT LAYER:\n" + (pageTextSnippet || "(not available)") + "\n\nPreviously extracted data:\n" + JSON.stringify({ bldg: parsed.bldg || null, units: firstPassUnits }) },
          ]}],
          generationConfig: { temperature: 0.1, maxOutputTokens: 8192 },
        });

        const verifyRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-flash-lite:generateContent?key=${GEMINI_API_KEY}`,
          { method: "POST", headers: { "Content-Type": "application/json" }, body: verifyBody }
        );

        if (verifyRes.ok) {
          const verifyData = await verifyRes.json();
          const verifyContent = verifyData.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
          console.log("AI Pass 2 (verify) response:", verifyContent.slice(0, 500));
          const verifyParsed = extractJSON(verifyContent);
          const verifiedUnits = cleanUnits(verifyParsed.units, verifyParsed.bldg || parsed.bldg || null, pageTextSnippet);

          if (verifiedUnits.length > 0) {
            const merged = new Map<string, typeof finalUnits[0]>();
            const makeKey = (u: typeof finalUnits[0]) => `${u.unitNumber.toUpperCase().replace(/\s+/g, '')}__${normalizeBldgKey(u.bldg)}`;
            for (const u of firstPassUnits) merged.set(makeKey(u), u);
            for (const u of verifiedUnits) merged.set(makeKey(u), u);
            const mergedUnits = Array.from(merged.values());
            mergedUnits.sort((a, b) => {
              const bldgCmp = (a.bldg || '').localeCompare(b.bldg || '', undefined, { numeric: true });
              if (bldgCmp !== 0) return bldgCmp;
              return a.unitNumber.localeCompare(b.unitNumber, undefined, { numeric: true });
            });
            // Safety: never let Pass 2 reduce count below Pass 1
            if (mergedUnits.length >= firstPassUnits.length) {
              finalUnits = mergedUnits;
            } else {
              console.warn(`Pass 2 merge would reduce ${firstPassUnits.length} → ${mergedUnits.length} units, keeping Pass 1`);
            }
          } else {
            console.log("Pass 2 returned empty — keeping Pass 1 results");
          }
          console.log("Pass 2 verified units:", finalUnits.length);
        } else {
          console.warn("Verification pass failed with status:", verifyRes.status, "— using Pass 1 results");
        }
      } catch (verifyErr) {
        console.warn("Verification pass error:", verifyErr, "— using Pass 1 results");
      }
    } else {
      console.log("Fast mode: skipping Pass 2 verification");
    }

    console.log("Final units:", finalUnits.length, JSON.stringify(finalUnits.map(u => `${u.bldg}/${u.unitNumber}`)));

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