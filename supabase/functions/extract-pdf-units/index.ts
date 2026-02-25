import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const systemPrompt = `You are an expert architectural drawing reader specializing in residential construction floor plans.

STEP 1 — FIND THE BUILDING NAME FIRST (most important):
Scan every word of the page text for a building identifier. Building names appear in many forms:
- Directional: "East Building", "West Building", "North Wing", "South Tower", "East Wing", "West Block"
- Numbered: "Building 1", "Building 2", "Bldg 1", "Bldg. 2", "Bldg A", "Block 1", "Block A"  
- Named: "Tower A", "Tower B", "Phase 1", "Phase 2", "Phase II", "Wing A", "Wing B"
- Combined: "Building 1 - East", "North Tower Phase 2", "West Block Bldg A"
- Project name followed by building: "Maple Gardens East Building", "Sunset Heights Bldg 2"
- Title block text (often at top or bottom): look for lines like "BUILDING: East", "BLDG: 1", "PROJECT: ... BUILDING: ..."
- Sheet title: e.g. "FLOOR PLAN - EAST BUILDING LEVEL 2" → building = "East Building"

RULE: If you find ANY building identifier anywhere on the page, set pageBuilding to it and apply to ALL units on that page unless a unit clearly has a different building label.

STEP 2 — FIND EVERY UNIT THAT VISUALLY HAS CABINETS AND/OR COUNTERTOPS:
Scan the ENTIRE floor plan IMAGE methodically — do NOT skip any area. For EVERY enclosed room/space on the plan, check if it contains cabinets or countertops. Only include a unit if you can VISUALLY SEE one or more of the following DRAWN INSIDE that unit's boundary:
- Cabinet rectangles (base cabinets, wall cabinets, vanity cabinets) — these appear as rectangular blocks along walls
- Countertop lines — continuous lines running along cabinet tops, L-shapes, U-shapes, or island shapes
- Kitchen appliance symbols: sink (circle or oval in counter), refrigerator (rectangle), range/cooktop, dishwasher (DW), microwave
- Bathroom vanity cabinets with sink symbols
- Laundry cabinets or folding counters

CRITICAL — DO NOT SKIP ANY UNIT:
- Scan the plan LEFT to RIGHT, TOP to BOTTOM. Check EVERY enclosed space.
- If you see cabinets/countertops drawn inside a space, include it — even if you cannot find a unit number or type label for it.
- For spaces with visible cabinets/countertops but NO unit number label: set unitNumber to "?" and include it. These will be flagged for manual review.
- For spaces with visible cabinets/countertops but NO type label: set detectedType to "?" (unknown).

CRITICAL — DO NOT INCLUDE UNITS THAT ARE BLANK OR EMPTY:
- If a unit space on the plan shows ONLY walls, doors, and windows with NO cabinet rectangles, NO counter lines, and NO appliance symbols visible inside it — DO NOT include that unit.
- A unit label existing on the plan is NOT enough. You must SEE actual cabinet/countertop/appliance drawings INSIDE that unit.
- Bedrooms, living rooms, closets, and hallways that have NO cabinets or countertops must be EXCLUDED even if they have a unit number label.
- When in doubt, EXCLUDE the unit. It is better to miss a unit than to include a blank one.

WHAT COUNTS AS CABINET/COUNTERTOP EVIDENCE (must be VISUALLY drawn):
- Rectangular blocks along walls (cabinets)
- L-shaped or U-shaped counter lines
- Sink symbols (circles/ovals inside counters)
- Appliance rectangles (fridge, range, DW)
- Vanity with sink in bathrooms
- Island or peninsula shapes

WHAT DOES NOT COUNT (do NOT use these alone as evidence):
- Just the word "kitchen" or "bath" in text without visible cabinet drawings
- Room labels alone
- Door swings or window marks
- Dimension lines
- General notes or legends

SPACES TO ALWAYS EXCLUDE (even if they have a label):
- Trash rooms, garbage rooms, refuse rooms, trash chutes, dumpster rooms
- Mechanical rooms, electrical rooms, telecom rooms, server rooms, MECH, ELEC, MEC, ELE
- Elevator shafts, elevator machine rooms
- Stairwells, exit stairs
- Storage closets (unless they clearly show cabinet/countertop drawings)
- Janitor closets, custodial closets
- Mail rooms, package rooms, concierge desks
These spaces virtually NEVER have cabinets or countertops. Do NOT include them.

SPACES TO INCLUDE IF CABINETS/COUNTERTOPS ARE VISUALLY DRAWN INSIDE:
- Community kitchens, kitchenettes, community room kitchens, kitchens beside community centers — these are common areas with FULL cabinet runs and countertops. ALWAYS include them if you see cabinets drawn inside.
- Laundry rooms — often have base cabinets, folding counters, or countertop surfaces above washers/dryers. Include if you see any cabinet rectangles or counter lines.
- Lobby areas with small countertop sections — some lobbies have a kitchenette, coffee bar, or small counter area. Include ONLY if you see drawn cabinet rectangles or countertop lines (a reception desk alone does NOT count).
- Reception areas, vestibules, foyers — include ONLY if cabinets or countertops are clearly drawn inside (not just furniture or desks).
- Corridors, hallways, waiting rooms — include ONLY if a kitchenette or counter area is drawn within the space.
- Offices — include ONLY if cabinet/countertop drawings are visible inside (a desk is NOT a cabinet).
- Fitness centers, clubhouses, leasing offices, break rooms, pantries — these commonly have kitchenettes with cabinets. ALWAYS check for cabinet drawings inside these spaces.
For ALL of the above: you MUST see drawn cabinet rectangles, countertop lines, or appliance symbols INSIDE the space boundary. A room label alone is NEVER sufficient.

UNIT NUMBERS vs UNIT TYPES — CRITICAL DISTINCTION:
- Unit NUMBERS are unique identifiers for individual apartments/spaces, typically numeric or alphanumeric with numbers: "101", "1-01", "A-08", "2-05", "3B", "B204", "#201". They appear near doors or inside room boundaries.
- Unit TYPES are category labels describing the layout/design: "Unit A", "Unit B", "UNIT TYPE 1.1B", "Type A5", "Studio", "1 BR", "2 BR". Multiple apartments can share the same type.
- NEVER use a type label (like "A", "B", "C", "D", "E", "J", "K", "M") as unitNumber. Always find the actual numeric/alphanumeric identifier for each apartment.
- For COMMON AREAS (laundry rooms, community rooms, etc.): ALWAYS look for a room number label (e.g. "103", "203", "303") near the space. If a room number is visible, use it as unitNumber. NEVER use the space name (like "Laundry", "Community Room") as the unitNumber — the space name goes in detectedType instead.

UNIT TYPES TO DETECT:
1. Residential: "Unit 101", "Apt 3B", "A-101", "B204", "101A", "#201", "1-01", "1-02", "A-08"
2. Common areas with cabinet content: These use the ROOM NUMBER as unitNumber and the SPACE NAME as detectedType. Examples:
   - Room labeled "103" with laundry cabinets → unitNumber: "103", detectedType: "Laundry"
   - Room labeled "111" with community kitchen → unitNumber: "111", detectedType: "Community Room"
   - If NO room number is visible, use "?-1", "?-2" etc. as unitNumber, NEVER use "Laundry" or "Community Room" as unitNumber

IMPORTANT - WHAT TO IGNORE:
- NEVER treat sheet/drawing numbers (e.g. "A-101.00", "A-102.00", "A-220") as unit numbers. These appear in title blocks next to "DRAWING NO:" or "SHEET:".
- NEVER extract units from reference tables like "UFAS APARTMENT LOCATIONS" or unit schedules. These tables list units from OTHER floors for cross-reference. Only extract units that are DRAWN on the actual floor plan with their unit number label near a door or within a room boundary.
- Ignore construction legend codes (C1, C2, D1, D2, etc.) — these are specification notes, not units.
- NEVER treat unit TYPE labels as unit NUMBERS. Labels like "UNIT A", "UNIT B", "UNIT C", "UNIT D", "UNIT E", "UNIT F", "UNIT G", "UNIT H", "UNIT I", "UNIT J", "UNIT K", "UNIT L", "UNIT M", "UNIT N", "UNIT P" are TYPE designations, NOT unit numbers. The actual unit numbers are the numeric identifiers near doors (e.g. "1-01", "1-02", "A-08", "2-05", "3-11", "4-06", "5-01"). When you see "UNIT A" next to room "1-01", that means unitNumber="1-01" and detectedType="Unit A".
- Ignore construction note codes like D30-D79, C1-C55 — these are work item references in construction legends, NOT unit numbers or room identifiers.

VERIFICATION PASS — DO NOT SKIP:
After your initial scan, do a SECOND pass over the entire floor plan to verify completeness:
- Re-examine EVERY corner and edge of the drawing. Units near edges, corners, or stairwells are commonly missed.
- Pay special attention to units whose labels may be small, rotated, partially obscured, or positioned far from their door. Example: "A-03" might appear as a tiny label near the boundary.
- If a unit number is visible ANYWHERE on the floor plan drawing (not in tables), and the corresponding space has cabinets/countertops, it MUST be in your output.
- HOWEVER: During verification, do NOT add units just because you see a label. You MUST ALSO confirm that cabinet rectangles, countertop lines, or appliance symbols are VISUALLY DRAWN INSIDE that unit's boundary. A unit label alone is NEVER sufficient evidence.
- COMMON AREA CROSS-CHECK: Specifically look for laundry rooms, community kitchens, kitchenettes, lobby countertops, fitness center kitchenettes, clubhouse kitchens, and other common spaces on EVERY floor. These are frequently missed! If you found a laundry on floors 1 and 2, check whether floors 3, 4, etc. also have one. Common areas often repeat on every floor with incrementing room numbers (103, 203, 303, 403). If you see the space with cabinets/countertops but missed it, add it now.
- LOBBY / COMMUNITY AREA CHECK: Go back and look specifically at areas near community centers, lobbies, and shared spaces. Even small countertop sections (coffee bars, kitchenettes, folding counters) MUST be included if cabinet rectangles or counter lines are drawn.

CRITICAL — BLANK UNIT FILTERING (FINAL CHECK):
- Before finalizing your output, review EACH unit in your list one more time.
- For EACH unit, ask: "Can I ACTUALLY SEE drawn cabinet rectangles, countertop lines, or appliance symbols INSIDE this unit's floor plan boundary?"
- If the answer is NO — if the unit interior shows ONLY walls, doors, windows, dimension lines, or empty space — REMOVE that unit from your output immediately.
- Units like bedrooms, living rooms, closets, corridors, and any space without physically drawn cabinetry MUST be excluded even if they have a unit number label on the plan.
- When in doubt, EXCLUDE. It is far better to miss a unit than to include a blank one.

RULES:
- Only include units whose number appears ON THE FLOOR PLAN DRAWING itself (near doors, corridors, or inside room boundaries), NOT in reference tables or schedules. EXCEPTION: if a space has visible cabinets/countertops but no unit number label, include it with unitNumber "?".
- ONLY include units where you can VISUALLY SEE cabinet rectangles, countertop lines, or appliance symbols DRAWN INSIDE that unit's floor plan boundary. If the unit interior is blank/empty — skip it.
- kitchenConfidence "yes" = clearly visible cabinets/countertops drawn inside the unit. "maybe" = you see some indicators but are not fully certain.

TYPE DETECTION — READ CAREFULLY:
- detectedType is MANDATORY for every unit — always provide it, never leave it null:
  * For RESIDENTIAL units: look for a TYPE label VERY CLOSE to the unit on the plan (e.g. "Type A5", "TYPE A1-3BR", "UNIT TYPE: B2"). The label must be clearly associated with THAT specific unit — do not guess or copy a type from a nearby unit.
  * READ the type label character by character. Common misreads: "E" vs "F", "I" vs "1", "B" vs "8", "D" vs "O". Zoom in mentally and be precise.
  * If you cannot find a type label clearly associated with the unit, set detectedType to "?" rather than guessing.
  * For COMMON AREAS: use the space/room name as the type (e.g. "Laundry", "Community Room", "Clubhouse", "Leasing Office", "Fitness", "Pantry", "Restroom").
- Floor: normalize word numbers ("First Floor" → "1", "Second" → "2", "Ground" → "G", "Basement" → "B1"). Keep letter-based levels as-is: "Level A" → "A", "Level B" → "B", "Level C" → "C", etc.
- When a page shows TWO floor plans (e.g. "Level A" and "1st Floor"), extract units from BOTH plans. Match each unit to its correct floor based on which plan section it appears in.
- Building: always inherit pageBuilding if unit has no specific building label

UNLABELED UNITS:
- If you see a space with clearly drawn cabinets/countertops but NO unit number visible anywhere near it, still include it with unitNumber "?" and add a sequential suffix like "?-1", "?-2" to distinguish multiple unlabeled units on the same page.
- If you see cabinets/countertops but cannot read the type label clearly, use detectedType "?".

Return ONLY valid JSON (no markdown fences, no explanation):
{
  "pageBuilding": "East Building" | null,
  "units": [
    {
      "unitNumber": "101" | "?-1",
      "detectedType": "Type A - 2 Bedroom" | "?" | null,
      "detectedFloor": "1" | null,
      "detectedBldg": "East Building" | null,
      "kitchenConfidence": "yes" | "maybe"
    }
  ]
}`;

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const OPENAI_API_KEY = Deno.env.get("OPENAI_API_KEY");
    const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
    if (!OPENAI_API_KEY && !GEMINI_API_KEY) throw new Error("No AI provider key configured");

    const body = await req.json();

    const pageText = body.pageText as string | undefined;
    const pageImage = body.pageImage as string | undefined; // base64 JPEG data URL or raw base64
    const pageIndex = (body.pageIndex as number) ?? 0;

    if ((!pageText || pageText.trim().length < 20) && !pageImage) {
      return new Response(JSON.stringify({ units: [] }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const titleBlock = (pageText ?? "").slice(0, 1500);
    const tailBlock = (pageText ?? "").slice(-800);
    const userPrompt = `Analyze this floor plan page (page ${pageIndex + 1}).\n\nSHEET TITLE / HEADER AREA (check here first for building name):\n${titleBlock}\n\nFOOTER / TITLE BLOCK:\n${tailBlock}\n\nFULL PAGE TEXT:\n${(pageText ?? "").slice(0, 8000)}`;

    const imageData = pageImage
      ? (pageImage.startsWith("data:") ? (pageImage.split(",")[1] ?? "") : pageImage)
      : "";

    let response: Response | null = null;
    let content = "";
    const MAX_RETRIES = 3;

    if (OPENAI_API_KEY) {
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        try {
          const contentParts: any[] = [];
          if (imageData) {
            contentParts.push({ type: "image_url", image_url: { url: `data:image/jpeg;base64,${imageData}` } });
          }
          contentParts.push({ type: "text", text: userPrompt });

          response = await fetch("https://api.openai.com/v1/chat/completions", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${OPENAI_API_KEY}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              model: "gpt-4o-mini",
              messages: [
                { role: "system", content: systemPrompt },
                { role: "user", content: contentParts },
              ],
              temperature: 0.1,
              max_tokens: 8192,
            }),
          });
        } catch (fetchErr) {
          console.error(`Page ${pageIndex + 1} openai fetch error (attempt ${attempt + 1}):`, fetchErr);
          if (attempt < MAX_RETRIES - 1) {
            await new Promise((r) => setTimeout(r, 2000 * (attempt + 1)));
            continue;
          }
          response = null;
          break;
        }

        if (response && (response.status === 503 || response.status === 500)) {
          console.warn(`Page ${pageIndex + 1} openai unavailable (${response.status}), attempt ${attempt + 1}`);
          response = null;
          if (attempt < MAX_RETRIES - 1) {
            await new Promise((r) => setTimeout(r, 3000 * (attempt + 1)));
            continue;
          }
          break;
        }

        break;
      }
    }

    const shouldTryGemini = Boolean(GEMINI_API_KEY) && (
      !OPENAI_API_KEY ||
      !response ||
      (response.status === 429 || response.status === 402 || response.status === 500 || response.status === 503)
    );

    if (shouldTryGemini) {
      console.warn(`Page ${pageIndex + 1}: OpenAI unavailable/quota-limited, falling back to Gemini`);
      const geminiParts: any[] = [{ text: `${systemPrompt}\n\n${userPrompt}` }];
      if (imageData) {
        geminiParts.unshift({ inline_data: { mime_type: "image/jpeg", data: imageData } });
      }

      const geminiResponse = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            contents: [{ parts: geminiParts }],
            generationConfig: {
              temperature: 0.1,
              maxOutputTokens: 8192,
              responseMimeType: "application/json",
            },
          }),
        },
      );

      if (geminiResponse.ok) {
        const geminiData = await geminiResponse.json();
        content = (geminiData.candidates?.[0]?.content?.parts ?? [])
          .map((part: any) => part.text ?? "")
          .join("\n")
          .trim();
      } else {
        const errText = await geminiResponse.text();
        console.error("Gemini fallback error:", geminiResponse.status, errText);
        response = geminiResponse;
      }
    }

    if (!content) {
      if (!response || !response.ok) {
        if (response?.status === 429) {
          return new Response(JSON.stringify({ error: "rate_limit" }), {
            status: 429,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        if (response?.status === 402) {
          return new Response(JSON.stringify({ error: "credits" }), {
            status: 402,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        return new Response(JSON.stringify({ units: [] }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const aiData = await response.json();
      content = aiData.choices?.[0]?.message?.content ?? "";
    }

    let parsed: { pageBuilding?: string | null; units: any[] } | null = null;
    try {
      const cleaned = content.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      parsed = JSON.parse(cleaned);
    } catch {
      const match = content.match(/\{[\s\S]*"units"\s*:\s*\[[\s\S]*\]\s*\}/);
      if (match) {
        try { parsed = JSON.parse(match[0]); } catch {}
      }
      if (!parsed) {
        console.error("Failed to parse AI response for page", pageIndex + 1, content.slice(0, 300));
        return new Response(JSON.stringify({ units: [] }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    const pageBuilding = parsed.pageBuilding ?? null;
    const units = (parsed.units ?? []).map((u: any) => ({
      unitNumber: (u.unitNumber ?? "").trim(),
      detectedType: u.detectedType ?? null,
      detectedFloor: u.detectedFloor ?? null,
      detectedBldg: u.detectedBldg ?? pageBuilding ?? null,
      kitchenConfidence: u.kitchenConfidence ?? "maybe",
    })).filter((u: any) => u.unitNumber.length > 0);

    console.log(`Page ${pageIndex + 1}: found ${units.length} units (image: ${!!pageImage})`);

    return new Response(JSON.stringify({ units }), {
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
