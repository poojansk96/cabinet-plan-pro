import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const SYSTEM_PROMPT = `You are an expert architectural plan reader. You are given an image of ONE page from an architectural floor plan set.

Your task: find EVERY unit/apartment/suite on this page and return its unit number and unit type.

WHERE TO LOOK:
- Unit numbers are near entry doors along corridors (e.g. "101", "102", "201", "01-105", "PH-1")
- Unit type labels are INSIDE the unit, often centered (e.g. "TYPE A", "A1", "B2", "Studio", "1BR")
- Also check any UNIT SCHEDULE or LEGEND table on the page — extract ALL entries from it
- Check the TITLE BLOCK (bottom-right corner) for building name

CRITICAL RULES:
- Extract ALL units on the page. Missing a unit is the worst error.
- Walk along EVERY corridor on BOTH sides. Check corners, corridor ends, near stairs/elevators.
- Do NOT return room names (Kitchen, Bath, Bedroom) as unit types.
- Do NOT return architectural labels (ELEVATION, SECTION, DETAIL, SCALE) as unit numbers.
- If no units exist on this page (cover sheet, detail page, section), return empty array.
- Read unit numbers carefully: "330" not "33", "1201" not "120".

Return ONLY valid JSON, no other text:
{"bldg":"Building Name or null","units":[{"unitNumber":"101","unitType":"TYPE A"},{"unitNumber":"102","unitType":"TYPE B"}]}`;

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
        bldg: String(u.bldg || pageBldg || "").trim() || null,
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
    const LOVABLE_API_KEY = Deno.env.get("LOVABLE_API_KEY");
    const useDirectGemini = !!GEMINI_API_KEY;
    const apiKey = (useDirectGemini ? GEMINI_API_KEY : LOVABLE_API_KEY)!;
    if (!apiKey) throw new Error("No AI API key configured");

    const { pageImage } = await req.json();
    if (!pageImage || typeof pageImage !== "string") {
      return new Response(JSON.stringify({ error: "pageImage required" }), {
        status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const model = useDirectGemini ? "gemini-2.5-flash" : "google/gemini-2.5-flash";
    let content = "";
    const MAX_RETRIES = 3;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        if (useDirectGemini) {
          const res = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
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
            },
          );
          if (!res.ok) {
            const status = res.status;
            if (status === 429) return new Response(JSON.stringify({ error: "rate_limit" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
            if (status === 402) return new Response(JSON.stringify({ error: "credits" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
            if ((status === 503 || status === 500) && attempt < MAX_RETRIES - 1) { await new Promise(r => setTimeout(r, 3000 * (attempt + 1))); continue; }
            throw new Error(`AI error ${status}`);
          }
          const data = await res.json();
          content = data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
        } else {
          const res = await fetch("https://ai.gateway.lovable.dev/v1/chat/completions", {
            method: "POST",
            headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
            body: JSON.stringify({
              model,
              messages: [{ role: "user", content: [
                { type: "image_url", image_url: { url: `data:image/jpeg;base64,${pageImage}` } },
                { type: "text", text: SYSTEM_PROMPT },
              ]}],
              temperature: 0.1,
              max_tokens: 4096,
            }),
          });
          if (!res.ok) {
            const status = res.status;
            if (status === 429) return new Response(JSON.stringify({ error: "rate_limit" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
            if (status === 402) return new Response(JSON.stringify({ error: "credits" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
            if ((status === 503 || status === 500) && attempt < MAX_RETRIES - 1) { await new Promise(r => setTimeout(r, 3000 * (attempt + 1))); continue; }
            throw new Error(`AI error ${status}`);
          }
          const data = await res.json();
          content = data.choices?.[0]?.message?.content ?? "";
        }
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
