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
    if (!GEMINI_API_KEY) throw new Error("GEMINI_API_KEY not configured");

    const { pageImage } = await req.json();

    if (!pageImage || typeof pageImage !== "string") {
      return new Response(JSON.stringify({ error: "pageImage (base64 string) required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const prompt = `You are an expert millwork estimator analyzing a countertop / stone plan from 2020 shop drawings.

TASK:
1. First, look at the TITLE BLOCK (usually bottom-right or top of the page). Extract the **unit type name EXACTLY and COMPLETELY as written** — preserve every word, parenthetical, suffix, and variant. Examples: "TYPE 1.1A (ADA)-AS", "TYPE A", "2BR-MIRROR", "A2 (ADA)", "STUDIO", "1.1A", "TOWNHOUSE-REV". Do NOT shorten, abbreviate, or remove any part of the name. If the title says "TYPE 1.1A (ADA) - AS" the unitType is "TYPE 1.1A (ADA)-AS". If it says "PLAN A2 MIRROR" the unitType is "PLAN A2 MIRROR". Include parenthetical suffixes like (ADA), (REV), (MIRROR), (SPLIT) etc. If no type is visible, set unitType to null.

2. Then extract every countertop section visible. For each section extract:
   a. **label** — a short descriptive name based on its location (e.g. "Perimeter Left", "Island", "Vanity", "L-Section"). If the drawing has text labels, use those.
   b. **length** — the FRONT-EDGE (top surface) linear measurement in inches, NOT the wall dimension. For the MAIN/LONGEST run of an L or U shape, use the full dimension as labeled. For RETURN LEGS (shorter segments that meet the main run at a corner), you MUST DEDUCT the depth of the perpendicular section from the wall dimension. Example: An L-shaped counter has a main run labeled 129" and a return labeled 39" on the wall. The return's front-edge length = 39" - 25.5" (the main run's depth) = 13.5". A separate standalone piece labeled 33" stays 33" because it does not share a corner with another piece. Read dimension labels first, then apply the corner deduction rule.
   c. **depth** — depth in inches. Standard kitchen countertop depth is 25.5". Islands are often 36-42". Vanity/bath tops are typically 22" or 19". Read from labels or use defaults.
   d. **category** — classify as "kitchen" or "bath":
      - If the drawing shows bathroom fixtures (toilet, tub), or text says "bath", "vanity", "powder", "master bath", "ensuite" → "bath"
      - If depth is 22" or less, or 19" → "bath"
      - Otherwise → "kitchen"
    e. **hasBacksplash** — true ONLY if you see a visible double line along the back edge of the countertop (indicating a backsplash), or if the drawing explicitly annotates a backsplash. If you do NOT see a double line, set to false.
    f. **backsplashLength** — IMPORTANT: backsplashLength uses WALL DIMENSIONS, NOT front-edge dimensions. The depth deduction rule for "length" does NOT apply here. For each edge where you see a double backsplash line, use the FULL WALL DIMENSION as labeled in the drawing. Example: An L-shaped counter has a main run of 129" and a return wall of 39". If backsplash runs along both walls, backsplashLength = 129 + 39 = 168 (NOT 129 + 13.5). The return's backsplash covers the full 39" wall, even though its top surface front edge is only 13.5". Do NOT add depth at corner junctions. If no double line is visible, set to 0.
    g. **sidesplashCount** — A sidesplash is a short double-line return at the OPEN END of the countertop where it terminates at a wall. STRICT RULE: Only count a sidesplash if you can CLEARLY SEE a distinct double line (two parallel lines close together) at that specific end of the countertop. Do NOT assume sidesplashes exist — you must visually confirm each one. If an end of the countertop is open (no wall, or connects to another section/appliance), it has NO sidesplash. If an end meets a wall but you do NOT see the characteristic double line there, it has NO sidesplash. Count 0, 1, or 2 based ONLY on what you visually see. Default to 0 when uncertain. Islands always have 0.
    h. **room** — the room this countertop is in (Kitchen, Bath, Laundry, Bar, Pantry, etc.)

RULES:
- Look for dimension lines, annotations, and measurements in the drawing
- For L-shaped or U-shaped runs, break them into individual straight segments
- If a countertop wraps around a corner, create separate sections for each leg — and DEDUCT the depth from the return leg's LENGTH (top surface front edge). But do NOT deduct depth from the return's BACKSPLASH LENGTH — backsplash runs along the full wall
- For a standalone rectangular section, the LONGER wall run is usually the length and the SHORT side dimension is the depth
- If a standalone piece shows a visible backsplash double line on one edge and also shows a side depth dimension around 25.5\" or 25 1/4\", treat it as a regular perimeter kitchen countertop section, NOT an island
- A piece is ONLY island-like if it has no visible backsplash double line and its depth is actually large (typically 30\"+)
- Do NOT mistake a 33\" wall-run with a 25.5\" side depth as a 33\"-deep island; in that case length = 33\" and depth = 25.5\"
- Do NOT include appliance surfaces (range top, sink cutout dimensions) as separate sections — they are part of the countertop run
- If the page has no countertop information, return {"unitType":null,"countertops":[]}
- Round all dimensions to nearest 0.5 inch
- Standard depths: perimeter kitchen = 25.5\", island = 36\", bar = 12-18\", vanity/bath = 22\"
- BACKSPLASH DETECTION: A double line at the back wall edge means backsplash is present. If you do NOT see a double line on an edge, that edge has NO backsplash — do not count it
- BACKSPLASH LENGTH vs TOP LENGTH: These are DIFFERENT. Top length uses front-edge (deducted at corners). Backsplash length uses the FULL WALL DIMENSION (no deduction). Never copy top length into backsplashLength for a return leg
- SIDESPLASH: ONLY count a sidesplash where you can clearly see a distinct double line at the short side/end of the countertop. Do NOT assume or infer sidesplashes — visually confirm each one. When in doubt, use 0. A countertop can have 0, 1, or 2 sidesplashes but most commonly has 0 or 1
- The unitType is the PLAN/UNIT TYPE identifier from the title block — NOT a room name like "Kitchen" or "Bath"

Return ONLY valid JSON — no markdown fences, no explanation:
{"unitType":"1.1B-AS","countertops":[{"label":"Perimeter Left","length":96,"depth":25.5,"category":"kitchen","hasBacksplash":true,"backsplashLength":135,"sidesplashCount":1,"room":"Kitchen"}]}`;

    let response: Response | null = null;
    const MAX_RETRIES = 3;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-3-flash-preview:generateContent?key=${GEMINI_API_KEY}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ role: "user", parts: [
                { inlineData: { mimeType: "image/jpeg", data: pageImage } },
                { text: prompt },
              ]}],
              generationConfig: { temperature: 0.2, maxOutputTokens: 65536 },
            }),
          }
        );
      } catch (fetchErr) {
        console.error(`AI fetch error (attempt ${attempt + 1}):`, fetchErr);
        if (attempt < MAX_RETRIES - 1) { await new Promise(r => setTimeout(r, 2000 * (attempt + 1))); continue; }
        throw fetchErr;
      }

      if (response && (response.status === 503 || response.status === 500)) {
        console.warn(`AI unavailable (${response.status}), attempt ${attempt + 1}/${MAX_RETRIES}`);
        response = null;
        if (attempt < MAX_RETRIES - 1) { await new Promise(r => setTimeout(r, 3000 * (attempt + 1))); continue; }
        return new Response(JSON.stringify({ error: "AI model temporarily unavailable.", countertops: [], unitType: null }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      break;
    }

    if (!response) {
      return new Response(JSON.stringify({ error: "AI model temporarily unavailable.", countertops: [], unitType: null }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (!response.ok) {
      const errText = await response.text();
      console.error("AI error:", response.status, errText);
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: "rate_limit" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: "credits" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ error: `AI error: ${response.status}`, countertops: [], unitType: null }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const aiData = await response.json();
    const content: string = aiData.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    console.log("AI countertop raw:", content.slice(0, 800));

    const normalizeUnitType = (value: unknown): string | null => {
      if (typeof value !== "string") return null;
      const ut = value
        .trim()
        .toUpperCase()
        .replace(/[\u2010-\u2015]/g, "-")
        .replace(/\s*-\s*/g, "-")
        .replace(/\(\s+/g, "(")
        .replace(/\s+\)/g, ")")
        .replace(/\s+/g, " ")
        .trim();
      return ut.length > 0 && ut.length <= 80 ? ut : null;
    };

    const mapCountertops = (items: any[] = []) => items.map((ct: any) => {
      const depth = Math.round((Number(ct.depth) || 25.5) * 2) / 2;
      let category: string = String(ct.category || "").toLowerCase();
      if (category !== "kitchen" && category !== "bath") {
        category = depth <= 22 ? "bath" : "kitchen";
      }
      const length = Math.round((Number(ct.length) || 96) * 2) / 2;
      const hasBacksplash = Boolean(ct.hasBacksplash);
      let backsplashLength = Math.round((Number(ct.backsplashLength) || 0) * 2) / 2;
      if (hasBacksplash && backsplashLength === 0) backsplashLength = length;
      // Sanity cap: backsplashLength should not exceed length + 2*depth for any single section
      const maxReasonableBacksplash = length + 2 * depth;
      if (backsplashLength > maxReasonableBacksplash) {
        console.warn(`Capping backsplashLength from ${backsplashLength} to ${maxReasonableBacksplash} for "${ct.label}"`);
        backsplashLength = maxReasonableBacksplash;
      }
      return {
        label: String(ct.label || "Section").trim(),
        length,
        depth,
        hasBacksplash,
        backsplashLength,
        sidesplashCount: Math.max(0, Math.min(2, Number(ct.sidesplashCount) || 0)),
        category,
        room: String(ct.room || "Kitchen").trim(),
      };
    });

    let parsed: { countertops: any[]; unitType?: string | null } = { countertops: [], unitType: null };
    try {
      let cleaned = content.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
      const jsonStart = cleaned.lastIndexOf('{"unitType"');
      const fallbackStart = cleaned.lastIndexOf('{"countertops"');
      const start = jsonStart >= 0 ? jsonStart : fallbackStart;
      if (start > 0) cleaned = cleaned.slice(start);
      parsed = JSON.parse(cleaned);
    } catch {
      console.error("JSON parse failed, raw:", content.slice(0, 500));
      const recoveredUnitType = normalizeUnitType(content.match(/"unitType"\s*:\s*"([^"]+)"/i)?.[1] ?? null);
      const recoveredRows: any[] = [];
      const rowPattern = /\{\s*"label"\s*:\s*"([^"]+)"[\s\S]*?"length"\s*:\s*([\d.]+)[\s\S]*?"depth"\s*:\s*([\d.]+)[\s\S]*?"category"\s*:\s*"(kitchen|bath)"[\s\S]*?"hasBacksplash"\s*:\s*(true|false)[\s\S]*?"backsplashLength"\s*:\s*([\d.]+)[\s\S]*?"sidesplashCount"\s*:\s*(\d+)[\s\S]*?"room"\s*:\s*"([^"]+)"[\s\S]*?\}/gi;
      let rowMatch: RegExpExecArray | null;
      while ((rowMatch = rowPattern.exec(content)) !== null) {
        recoveredRows.push({
          label: rowMatch[1],
          length: Number(rowMatch[2]),
          depth: Number(rowMatch[3]),
          category: rowMatch[4],
          hasBacksplash: rowMatch[5] === "true",
          backsplashLength: Number(rowMatch[6]),
          sidesplashCount: Number(rowMatch[7]),
          room: rowMatch[8],
        });
      }
      parsed = { unitType: recoveredUnitType, countertops: recoveredRows };
    }

    const unitType = normalizeUnitType(parsed.unitType);
    const countertops = mapCountertops(parsed.countertops ?? []);

    return new Response(JSON.stringify({ countertops, unitType }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("extract-pdf-countertops error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
