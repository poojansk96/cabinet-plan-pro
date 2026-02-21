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

    const prompt = `You are reading a 2020 Design shop drawing page. This is a cabinet/countertop elevation or floor plan for a residential unit.

YOUR TASK: Find the UNIT NUMBER on this page. Every page has one.

WHERE TO LOOK (in order of priority):
1. TITLE BLOCK — the information box at the bottom-right or bottom of the page. It contains the unit identifier. Look for text like:
   - "UNIT 01-105" or "01-105"
   - "UNIT #201" or "#201"  
   - "APT 3B" or "Suite 105"
   - Any alphanumeric code that identifies a dwelling unit (format: XX-XXX, XXX, or similar)
2. PAGE HEADER — sometimes the unit number appears at the top of the page
3. NEAR ROOM LABELS — the unit number may appear near "Kitchen", "Master Bath", etc.
4. FLOOR PLAN LABELS — if this is a floor plan, find ALL unit numbers at doors/corridors

WHAT IS A UNIT NUMBER:
- A dwelling identifier: "01-101", "01-105", "02-201", "03-301", "04-401", "PH-1", "105", "201"
- Format is often "XX-YYY" where XX = floor/building code, YYY = unit number
- Can also be simple numbers: "101", "202", "305"
- NOT cabinet SKUs (B24, W3036, VB24)
- NOT room names (Kitchen, Master Bath, Living Room)
- NOT page numbers or sheet numbers (A1, A2, S1)

UNIT TYPE: If you see a type designation (TYPE A, Unit A, 2BR), include it. Otherwise use "".

BUILDING: If you see a building/project name, include it. Otherwise use null.

IMPORTANT: 
- You MUST find at least one unit number. Every 2020 Design page belongs to a unit.
- Read ALL text in the title block carefully — the unit number is always there.
- If multiple units are on the page (floor plan), extract ALL of them.

Return ONLY valid JSON, no markdown:
{"pageType":"floor_plan","bldg":null,"units":[{"unitNumber":"01-105","unitType":""}]}`;

    const fallbackPrompt = `This is a 2020 Design shop drawing. Read the TITLE BLOCK (the information box at the bottom or right side of the page). 

Find the UNIT NUMBER — it's a dwelling identifier like "01-105", "02-201", "03-301", "Unit 201", etc.

DO NOT return cabinet SKUs, room names, or page numbers. Return the UNIT/APARTMENT identifier.

Return ONLY valid JSON:
{"pageType":"floor_plan","bldg":null,"units":[{"unitNumber":"THE_UNIT_NUMBER_YOU_FOUND","unitType":""}]}`;

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
