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

    const { pageImage, unitType } = await req.json();

    if (!pageImage || typeof pageImage !== "string") {
      return new Response(JSON.stringify({ error: "pageImage (base64 string) required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const prompt = `You are an expert millwork estimator reading a 2020 Design shop drawing page.

These are 2020 Design software shop drawings. They contain THREE types of pages:

PAGE TYPES:
  A) TITLE PAGE / COVER PAGE — contains project info, unit type name, unit numbers. No cabinet drawings.
  B) PLAN VIEW PAGE (top-down view) — shows cabinets from ABOVE as rectangular outlines with SKU labels written on or next to each cabinet. Walls appear as thick lines. You see the room layout from a bird's-eye perspective. Cabinet SKU labels like "B24", "W3030B", "DB15", "BF3" are placed directly on/near the cabinet shapes.
  C) ELEVATION PAGE (front/side view) — shows cabinets as you would see them standing in front of them. Rectangular boxes stacked vertically (base on bottom, wall on top). Has dimension lines showing heights.

WHAT TO DO FOR EACH PAGE TYPE:
- TITLE PAGE → return {"unitTypeName":"<detected type>","items":[]}
- PLAN VIEW PAGE → EXTRACT all cabinet SKU labels AND detect the unit type name from the page title/header
- ELEVATION PAGE → DO NOT extract. Return {"unitTypeName":null,"items":[]}
  *** Elevation pages show the SAME cabinets already visible on plan view pages. Extracting from both would cause double-counting. Only extract from PLAN VIEW pages. ***

HOW TO TELL PLAN VIEW vs ELEVATION:
- PLAN VIEW: You look DOWN at the room. Cabinets are flat rectangular outlines along walls. Labels are placed inside or beside the cabinet shapes. You see the room shape from above.
- ELEVATION: You look at the FRONT of cabinets. You see cabinet doors/drawers as tall rectangles. Dimension lines show heights (e.g. 32 7/8", 65 3/4"). Base cabinets sit on the bottom, wall cabinets hang at the top.

TASK 1 — DETECT UNIT TYPE NAME (ALL PAGE TYPES):
- Look for the UNIT TYPE NAME in the title block, header, sheet title, or prominent labels on EVERY page.
- The unit type name is typically found in the title block at the bottom or side of the page, or in a header/label.
- Common formats: "TYPE 1 - AS", "TYPE 1 - MIRROR", "TYPE 2 - ADA", "TYPE 3 - AS", "TYPE 5 - MIRROR", "Studio", "1 Bed", "1B-Mirror", etc.
- This identifies WHICH unit type this drawing page belongs to.
- ALWAYS try to detect this, even on plan view and elevation pages — it's usually in the title block.
- Return null ONLY if you truly cannot find any unit type identifier on the page.

TASK 2 — EXTRACT CABINET SKUs (PLAN VIEW PAGES ONLY):
For each cabinet SKU label on the plan view, extract:
1. SKU exactly as written (e.g. B24, W3036, T84, VB30, BF3, WF6X30, FIL3, TKRUN96, CM8, LS36-L, DB15, B09FH, BLW36/3930-L)
2. Cabinet type by prefix:
   BASE      → B DB SB CB EB LS LSB (but NOT BLW/BRW — those are Wall)
   WALL      → W UB WC OH BLW BRW (BLW = Blind Left Wall, BRW = Blind Right Wall)
   TALL      → T UT TC PT PTC UC
   VANITY    → V VB VD
   ACCESSORY → FIL BF WF BFFIL WFFIL TK TKRUN CM LR EP FP DWR
3. Room — from room labels on the plan (Kitchen, Bath, Laundry, Pantry → capitalize first letter only)

COUNTING — CRITICAL:
- Count EVERY separate SKU label occurrence on the plan view page.
- If "DB15" label appears in TWO different spots → quantity 2.
- If "BF3" label appears once → quantity 1. Do NOT skip small accessories.
- ACCESSORIES MATTER: BF3, BF6, WF3X30, WF6X30, DWR3, DWR6 — count EVERY single occurrence. These small labels are easy to miss — scan the ENTIRE plan carefully including corners, edges, and between cabinets.
- SMALL BASE CABINETS: B09FH, B06FH, B12FH etc. — these are small filler-head base cabinets. They appear as very narrow rectangles on the plan. Do NOT skip them.
- Corner cabinets (LS, LSB) sit at the corner where two walls meet — count only ONCE even if the label appears at the junction of two wall runs.
- Look for "xN" or "(2)" multiplier notation.

STACKED / ADJACENT LABELS — CRITICAL:
- On plan views, TWO or MORE SKU labels may appear STACKED VERTICALLY or placed very close together near the SAME cabinet location. These are SEPARATE cabinets, NOT one combined SKU.
- Example: "W1230" on one line and "VDC2430" on the next line → these are TWO different cabinets: W1230 (qty 1) AND VDC2430 (qty 1).
- Example: "B12FH" near "LS36-R" → TWO different cabinets, not one.
- Example: "HAUC15X82", "HCOC3082", "HCDBC15" stacked → THREE separate cabinets, each qty 1.
- NEVER concatenate or merge adjacent labels into a single SKU. Each distinct text string that matches a valid SKU pattern is its OWN cabinet entry.
- If you see a cabinet outline with multiple labels near it, each label is a separate cabinet item.

ELEVATION PAGE DETECTION — VERY IMPORTANT:
- If you see cabinet DOORS and DRAWERS as tall rectangles with DIMENSION LINES showing heights (e.g. 32 7/8", 65 3/4"), this is an ELEVATION page.
- Elevation pages show the SAME cabinets already on the plan view. Extracting from both causes DOUBLE-COUNTING.
- When in doubt whether a page is plan view or elevation, return EMPTY items: {"unitTypeName":"<detected type>","items":[]}

RULES:
- Valid SKU: starts with a LETTER, contains at least one NUMBER (e.g. B24, BF3, DB15, W3036, B09FH)
- SKIP appliances: REF REFRIG DW DISHWASHER RANGE HOOD MICRO OTR OVEN
- SKIP non-SKU text: unit numbers, unit type names, elevation titles, dimension text, page numbers, sheet references, call-out bubbles
- Read labels EXACTLY as printed — do not invent or guess
- If NO SKUs found → return {"unitTypeName":"<detected type or null>","items":[]}
${unitType ? \`- Unit type context: \${unitType}\` : ""}

Return ONLY valid JSON — no markdown, no explanation:
{"unitTypeName":"A1-AS","items":[{"sku":"B24","type":"Base","room":"Kitchen","quantity":1},{"sku":"DB15","type":"Base","room":"Kitchen","quantity":2},{"sku":"BF3","type":"Accessory","room":"Kitchen","quantity":1}]}\`;

    let response: Response | null = null;
    const MAX_RETRIES = 3;
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${GEMINI_API_KEY}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ role: "user", parts: [
                { inlineData: { mimeType: "image/jpeg", data: pageImage } },
                { text: prompt },
              ]}],
              generationConfig: { temperature: 0.1, maxOutputTokens: 8192 },
            }),
          }
        );
      } catch (fetchErr) {
        console.error(`AI fetch error (attempt ${attempt + 1}):`, fetchErr);
        if (attempt < MAX_RETRIES - 1) { await new Promise(r => setTimeout(r, 2000 * (attempt + 1))); continue; }
        throw fetchErr;
      }

      if (response.status === 503 || response.status === 500) {
        const errText = await response.text();
        console.warn(`AI unavailable (${response.status}), attempt ${attempt + 1}/${MAX_RETRIES}:`, errText.slice(0, 200));
        response = null;
        if (attempt < MAX_RETRIES - 1) { await new Promise(r => setTimeout(r, 3000 * (attempt + 1))); continue; }
        return new Response(JSON.stringify({ error: "AI model temporarily unavailable. Please try again in a moment.", items: [] }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      break;
    }

    if (!response) {
      return new Response(JSON.stringify({ error: "AI model temporarily unavailable. Please try again in a moment.", items: [] }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (!response.ok) {
      const errText = await response.text();
      console.error("AI gateway error:", response.status, errText);
      if (response.status === 429) return new Response(JSON.stringify({ error: "rate_limit" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      if (response.status === 402) return new Response(JSON.stringify({ error: "credits" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ error: `AI error: ${response.status}`, items: [] }), { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    const aiData = await response.json();
    const content: string = aiData.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    console.log("AI Pass 1 raw:", content.slice(0, 800));

    function extractJson(raw: string): any {
      let cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
      // Find the FIRST top-level '{' that starts the JSON object
      const firstBrace = cleaned.indexOf('{');
      if (firstBrace !== -1) {
        cleaned = cleaned.substring(firstBrace);
      }
      // Try parsing as-is first
      try { return JSON.parse(cleaned); } catch {}
      // If truncated, try to recover: close any open arrays/objects
      // Find "items" array and extract whatever items we got
      const itemsMatch = cleaned.match(/"items"\s*:\s*\[/);
      if (itemsMatch) {
        const arrStart = cleaned.indexOf('[', cleaned.indexOf('"items"'));
        // Find the last complete item (ending with })
        const lastCompleteItem = cleaned.lastIndexOf('}');
        if (arrStart !== -1 && lastCompleteItem > arrStart) {
          const itemsStr = cleaned.substring(arrStart, lastCompleteItem + 1) + ']';
          // Extract unitTypeName if present
          const typeMatch = cleaned.match(/"unitTypeName"\s*:\s*"([^"]*?)"/);
          const unitTypeName = typeMatch ? typeMatch[1] : null;
          try {
            const items = JSON.parse(itemsStr);
            console.log(`Recovered ${items.length} items from truncated JSON`);
            return { unitTypeName, items };
          } catch {}
        }
      }
      // Last resort: try closing braces
      let attempt = cleaned;
      for (let i = 0; i < 5; i++) {
        attempt += ']}';
        try { return JSON.parse(attempt); } catch {}
      }
      throw new Error("Could not parse JSON");
    }

    let parsed: { items: any[]; unitTypeName?: string | null } = { items: [] };
    try { parsed = extractJson(content); } catch { console.error("Pass 1 JSON parse failed:", content.slice(0, 500)); }

    const detectedUnitType = parsed.unitTypeName ?? null;
    const pass1Items = parsed.items ?? [];
    console.log(`Pass 1: ${pass1Items.length} items, unitType: ${detectedUnitType}`);

    // ── PASS 2: Verification — re-examine image to catch missed SKUs ──
    // IMPORTANT: never replace Pass 1 entirely, because Pass 2 can miss labels.
    // Merge both passes and keep the higher quantity per SKU+room.
    let finalItems = pass1Items;
    if (pass1Items.length > 0) {
      const verifyPrompt = `You are an expert millwork estimator doing a SECOND verification pass on a 2020 Design shop drawing PLAN VIEW page.

Pass 1 found these cabinet SKUs:
${JSON.stringify(pass1Items)}

Your job: Look at the SAME image again VERY carefully and check for:
1. MISSED SKUs — any cabinet label visible on the plan view that is NOT in the list above. Pay special attention to small accessories like BF3, BF6, WF3X30, WF6X30, FIL3, TK, CM, LR, EP.
2. WRONG quantities — if a SKU label appears multiple times in different locations, the quantity should match the number of occurrences (e.g. DB15 appearing twice = quantity 2).
3. FALSE entries — any SKU in the list that does NOT actually appear as a label on this page.

IMPORTANT:
- Only extract from PLAN VIEW (top-down) pages. If this is an elevation (front view), return {"items":[]}.
- SKIP appliances (REF, DW, RANGE, HOOD, MICRO, OTR, OVEN, etc.)
- Read labels EXACTLY as printed.
- Corner cabinets (LS, LSB): count only ONCE even if at junction of two walls.
- STACKED LABELS: If multiple SKU labels appear stacked vertically or adjacent near one cabinet location (e.g. "W1230" above "VDC2430", or "HAUC15X82" / "HCOC3082" / "HCDBC15"), each is a SEPARATE cabinet entry. NEVER merge them into one SKU.

Return the COMPLETE corrected list as JSON — no markdown, no explanation:
{"items":[{"sku":"B24","type":"Base","room":"Kitchen","quantity":1}]}`;

      try {
        const verifyRes = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${GEMINI_API_KEY}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ role: "user", parts: [
                { inlineData: { mimeType: "image/jpeg", data: pageImage } },
                { text: verifyPrompt },
              ]}],
              generationConfig: { temperature: 0.1, maxOutputTokens: 8192 },
            }),
          }
        );

        if (verifyRes.ok) {
          const verifyData = await verifyRes.json();
          const verifyContent: string = verifyData.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
          console.log("Pass 2 verify:", verifyContent.slice(0, 800));
          try {
            const verifyParsed = extractJson(verifyContent);
            const pass2Items = verifyParsed.items ?? [];
            if (pass2Items.length > 0) {
              const mergedByKey = new Map<string, any>();
              for (const item of pass1Items) {
                const sku = String(item?.sku ?? '').toUpperCase().trim().replace(/\s*-\s*/g, '-').replace(/\s+/g, '');
                const room = String(item?.room ?? 'Kitchen').trim();
                if (!sku) continue;
                mergedByKey.set(`${sku}|${room}`, item);
              }
              for (const item of pass2Items) {
                const sku = String(item?.sku ?? '').toUpperCase().trim().replace(/\s*-\s*/g, '-').replace(/\s+/g, '');
                const room = String(item?.room ?? 'Kitchen').trim();
                if (!sku) continue;
                const key = `${sku}|${room}`;
                const existing = mergedByKey.get(key);
                if (!existing) {
                  mergedByKey.set(key, item);
                  continue;
                }
                mergedByKey.set(key, {
                  ...existing,
                  ...item,
                  quantity: Math.max(Number(existing.quantity) || 1, Number(item.quantity) || 1),
                });
              }
              finalItems = Array.from(mergedByKey.values());
              console.log(`Pass 2 merge: pass1=${pass1Items.length}, pass2=${pass2Items.length}, final=${finalItems.length}`);
            }
          } catch {
            console.error("Pass 2 JSON parse failed, using Pass 1");
          }
        } else {
          console.warn("Pass 2 call failed:", verifyRes.status);
        }
      } catch (e) {
        console.warn("Pass 2 error, using Pass 1:", e);
      }
    }

    // ── PASS 3: Targeted hunt for commonly missed small/narrow SKUs ──
    // Uses gemini-2.5-pro for better visual reasoning on tiny labels
    const existingSkus = new Set(finalItems.map((i: any) => String(i?.sku ?? '').toUpperCase().trim()));
    const COMMONLY_MISSED = ['B09FH','B06FH','B12FH','BF3','BF6','WF3X30','WF6X30','FIL3','DWR3','DWR6','CM8','TK','TKRUN','EP','LR','SCRIBE','BP'];
    const missingCandidates = COMMONLY_MISSED.filter(s => !existingSkus.has(s));

    if (missingCandidates.length > 0 && finalItems.length > 0) {
      const pass3Prompt = `You are an expert millwork estimator doing a FINAL careful check on a 2020 Design shop drawing PLAN VIEW page.

Previous passes found these SKUs: ${[...existingSkus].join(', ')}

TASK: Look at this plan view image ONE MORE TIME with extreme care. Focus ONLY on finding these SPECIFIC SKUs that may have been MISSED:
${missingCandidates.join(', ')}

These are typically:
- B09FH, B06FH, B12FH = Very NARROW filler-head base cabinets, shown as thin/narrow rectangles on the plan. They are easy to overlook because they are so small.
- BF3, BF6 = Base fillers — tiny narrow strips between cabinets, labeled with small text
- WF3X30, WF6X30 = Wall fillers — small strips near wall cabinets
- FIL3, DWR3, DWR6, CM8, TK, TKRUN, EP, LR = Small accessories

INSTRUCTIONS:
1. Scan the ENTIRE plan view carefully — especially corners, edges between cabinets, and tight spaces
2. Look for ANY small text labels that match the SKUs listed above
3. For each one you find, note the SKU, room, and count how many times it appears
4. If this is an ELEVATION page (front view with dimension lines), return {"items":[]}
5. Only report SKUs you can ACTUALLY SEE labeled on the drawing — do not guess

Return ONLY the NEWLY FOUND items as JSON — no markdown, no explanation:
{"items":[{"sku":"B09FH","type":"Base","room":"Kitchen","quantity":1}]}
If none found, return {"items":[]}`;

      try {
        const pass3Res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-pro:generateContent?key=${GEMINI_API_KEY}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ role: "user", parts: [
                { inlineData: { mimeType: "image/jpeg", data: pageImage } },
                { text: pass3Prompt },
              ]}],
              generationConfig: { temperature: 0.2, maxOutputTokens: 4096 },
            }),
          }
        );

        if (pass3Res.ok) {
          const pass3Data = await pass3Res.json();
          const pass3Content: string = pass3Data.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
          console.log("Pass 3 targeted:", pass3Content.slice(0, 500));
          try {
            const pass3Parsed = extractJson(pass3Content);
            const pass3Items = pass3Parsed.items ?? [];
            if (pass3Items.length > 0) {
              for (const item of pass3Items) {
                const sku = String(item?.sku ?? '').toUpperCase().trim().replace(/\s*-\s*/g, '-').replace(/\s+/g, '');
                const room = String(item?.room ?? 'Kitchen').trim();
                if (!sku) continue;
                // Only add genuinely new SKUs
                const key = `${sku}|${room}`;
                const alreadyExists = finalItems.some((e: any) => {
                  const eKey = `${String(e?.sku ?? '').toUpperCase().trim()}|${String(e?.room ?? 'Kitchen').trim()}`;
                  return eKey === key;
                });
                if (!alreadyExists) {
                  finalItems.push(item);
                  console.log(`Pass 3 found missed SKU: ${sku} (${room}) qty ${item.quantity}`);
                }
              }
            }
          } catch {
            console.error("Pass 3 JSON parse failed");
          }
        } else {
          console.warn("Pass 3 call failed:", pass3Res.status);
        }
      } catch (e) {
        console.warn("Pass 3 error:", e);
      }
    }

    const rawItems = finalItems;
    console.log(`Final: ${rawItems.length} items`);

    // Filter: must start with letter AND contain a number (real SKU, not labels/titles)
    // Appliance prefixes to reject
    const APPLIANCE_RE = /^(REF|REFRIG|REFRIGERATOR|DW(?!R)|DDW|DISHWASHER|DISHW|RANGE|HOOD|MICRO|OTR|OVEN|COOK|STOVE|MW|WM|WASHER|DRYER|FREEZER|WINE|ICE|TRASH|COMPACT|SINK|FAN|VENT|DISP|CKT)/i;

    // SKUs that are valid even without digits
    const NO_DIGIT_OK = /^(BP|SCRIBE)$/i;
    const items = (rawItems)
      .filter((c: any) => c.sku && /^[A-Za-z]/.test(c.sku) && (/\d/.test(c.sku) || NO_DIGIT_OK.test(String(c.sku).trim())))
      .filter((c: any) => {
        const upper = String(c.sku).toUpperCase().trim();
        if (APPLIANCE_RE.test(upper)) return false;
        if (/^UNIT\b/i.test(upper)) return false;
        if (/^ELEV/i.test(upper)) return false;
        if (/^FLOOR/i.test(upper)) return false;
        if (/^TYPE\s/i.test(upper)) return false;
        if (/^WALL\s+[A-Z]$/i.test(upper)) return false;
        if (/^[A-Z]\d?-[A-Z]/i.test(upper) && upper.length <= 4) return false;
        return true;
      })
      .map((c: any) => {
        const sku = String(c.sku).toUpperCase().trim().replace(/\s*-\s*/g, '-').replace(/\s+/g, '');
        let rawType = String(c.type ?? "Base").trim();
        // Force-correct BLW/BRW to Wall (Blind Left/Right Wall) — AI sometimes classifies as Base
        if (/^BLW|^BRW/i.test(sku)) rawType = "Wall";
        const normalizedType = rawType.charAt(0).toUpperCase() + rawType.slice(1).toLowerCase();
        const rawRoom = String(c.room ?? "Kitchen").trim();
        const normalizedRoom = rawRoom.charAt(0).toUpperCase() + rawRoom.slice(1).toLowerCase();
        return {
          sku,
          type: normalizedType,
          room: normalizedRoom,
          quantity: Number(c.quantity) || 1,
        };
      });

    // Deduplicate by SKU+room.
    // Corner Lazy Susan SKUs (LS/LSB) appear on two adjacent elevations for one cabinet — use max.
    const isCornerLazySusan = (sku: string) => /^(LS|LSB)\d+/i.test(sku);
    const deduped = new Map<string, { sku: string; type: string; room: string; quantity: number }>();
    for (const item of items) {
      const key = `${item.sku}|${item.room}`;
      const existing = deduped.get(key);
      if (existing) {
        existing.quantity = isCornerLazySusan(item.sku)
          ? Math.max(existing.quantity, item.quantity)
          : existing.quantity + item.quantity;
      } else {
        deduped.set(key, { ...item });
      }
    }

    return new Response(JSON.stringify({ items: Array.from(deduped.values()), unitTypeName: detectedUnitType }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("extract-pdf-labels error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
