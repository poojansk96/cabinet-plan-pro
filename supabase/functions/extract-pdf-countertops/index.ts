import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type ModelAttempt = { name: string; retries: number };

const PRIMARY_MODELS: ModelAttempt[] = [
  { name: "gemini-3-flash-preview", retries: 3 },
  { name: "gemini-2.5-flash", retries: 2 },
];

const VERIFY_MODELS: ModelAttempt[] = [
  { name: "gemini-3-flash-preview", retries: 2 },
];

async function requestGemini(
  apiKey: string,
  imageData: string,
  prompt: string,
  models: ModelAttempt[],
  generationConfig: { temperature: number; maxOutputTokens: number },
): Promise<string> {
  let response: Response | null = null;

  for (const { name: model, retries } of models) {
    console.log(`Trying Gemini model: ${model} (${retries} attempts)`);
    let succeeded = false;

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{ role: "user", parts: [
                { inlineData: { mimeType: "image/jpeg", data: imageData } },
                { text: prompt },
              ]}],
              generationConfig,
            }),
          }
        );
      } catch (fetchErr) {
        console.error(`AI fetch error (${model}, attempt ${attempt + 1}):`, fetchErr);
        if (attempt < retries - 1) { await new Promise(r => setTimeout(r, 2000 * (attempt + 1))); continue; }
        response = null;
        break;
      }

      if (response.status === 429) throw new Error("rate_limit");
      if (response.status === 402) throw new Error("credits");

      if (response.status === 503 || response.status === 500) {
        console.warn(`AI unavailable (${response.status}) for ${model}, attempt ${attempt + 1}/${retries}`);
        response = null;
        if (attempt < retries - 1) { await new Promise(r => setTimeout(r, 2000 * (attempt + 1))); continue; }
        break;
      }

      if (!response.ok) {
        const errText = await response.text();
        console.error("AI error:", response.status, errText);
        throw new Error(`AI error: ${response.status}`);
      }

      succeeded = true;
      break;
    }

    if (succeeded && response) {
      const aiData = await response.json();
      return aiData.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
    }

    console.warn(`Model ${model} failed, trying next fallback...`);
  }

  throw new Error("ai_unavailable");
}

// ── Dialagram (OpenAI-compatible Qwen) ──
const DIALAGRAM_BASE_URL = "https://www.dialagram.me/router/v1";

async function requestDialagram(
  apiKey: string,
  imageData: string,
  prompt: string,
  model: string,
  temperature: number,
  maxTokens: number,
): Promise<string> {
  const MAX_RETRIES = 3;
  let response: Response | null = null;

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    try {
      response = await fetch(`${DIALAGRAM_BASE_URL}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Accept": "application/json",
          "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model,
          temperature,
          max_tokens: maxTokens,
          stream: false,
          messages: [
            {
              role: "user",
              content: [
                {
                  type: "image_url",
                  image_url: { url: `data:image/jpeg;base64,${imageData}` },
                },
                { type: "text", text: prompt },
              ],
            },
          ],
        }),
      });
    } catch (fetchErr) {
      console.error(`Dialagram fetch error (attempt ${attempt + 1}):`, fetchErr);
      if (attempt < MAX_RETRIES - 1) { await new Promise(r => setTimeout(r, 2000 * (attempt + 1))); continue; }
      throw new Error("ai_unavailable");
    }

    if (response.status === 429) throw new Error("rate_limit");
    if (response.status === 402) throw new Error("credits");
    if (response.status === 503 || response.status === 500) {
      console.warn(`Dialagram unavailable (${response.status}), attempt ${attempt + 1}/${MAX_RETRIES}`);
      if (attempt < MAX_RETRIES - 1) { await new Promise(r => setTimeout(r, 2000 * (attempt + 1))); continue; }
      throw new Error("ai_unavailable");
    }
    if (!response.ok) {
      const errText = await response.text();
      console.error("Dialagram error:", response.status, errText);
      throw new Error(`AI error: ${response.status}`);
    }

    return await parseDialagramResponse(response);
  }
  throw new Error("ai_unavailable");
}

// Parse Dialagram response — handles both standard JSON and SSE streaming format.
async function parseDialagramResponse(response: Response): Promise<string> {
  const raw = await response.text();
  const trimmed = raw.trim();

  // Standard JSON response
  if (trimmed.startsWith("{")) {
    try {
      const data = JSON.parse(trimmed);
      return data.choices?.[0]?.message?.content ?? "";
    } catch (err) {
      console.error("Dialagram JSON parse failed:", err, "raw:", trimmed.slice(0, 300));
      throw new Error("ai_unavailable");
    }
  }

  // SSE streaming response: lines like `data: {...}` and a final `data: [DONE]`
  if (trimmed.startsWith("data:")) {
    let assembled = "";
    const lines = raw.split("\n");
    for (const line of lines) {
      const l = line.trim();
      if (!l.startsWith("data:")) continue;
      const payload = l.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const chunk = JSON.parse(payload);
        const delta = chunk.choices?.[0]?.delta?.content
          ?? chunk.choices?.[0]?.message?.content
          ?? "";
        if (delta) assembled += delta;
      } catch {
        // skip non-JSON SSE lines (e.g. `id:`, `event:`)
      }
    }
    if (assembled) return assembled;
    console.error("Dialagram SSE returned no content. Raw:", raw.slice(0, 500));
    throw new Error("ai_unavailable");
  }

  console.error("Dialagram returned unexpected format:", raw.slice(0, 300));
  throw new Error("ai_unavailable");
}

async function callAI(
  provider: "gemini" | "dialagram",
  imageData: string,
  prompt: string,
  opts: { temperature: number; maxOutputTokens: number; geminiModels: ModelAttempt[]; dialagramModel: string },
): Promise<string> {
  if (provider === "dialagram") {
    const key = Deno.env.get("DIALAGRAM_API_KEY");
    if (!key) throw new Error("DIALAGRAM_API_KEY not configured");
    return requestDialagram(key, imageData, prompt, opts.dialagramModel, opts.temperature, opts.maxOutputTokens);
  }
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) throw new Error("GEMINI_API_KEY not configured");
  return requestGemini(key, imageData, prompt, opts.geminiModels, { temperature: opts.temperature, maxOutputTokens: opts.maxOutputTokens });
}

function parseCountertopJSON(content: string): { unitTypeName: string; countertops: any[] } {
  let parsed: { unitTypeName?: string; countertops?: any[] } = { countertops: [] };
  try {
    let cleaned = content.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/```\s*$/i, "").trim();
    const jsonStart = cleaned.indexOf('{"unitTypeName"');
    if (jsonStart >= 0) {
      cleaned = cleaned.slice(jsonStart);
    } else {
      const altStart = cleaned.indexOf('{"countertops"');
      if (altStart > 0) cleaned = cleaned.slice(altStart);
    }
    const end = cleaned.lastIndexOf("}");
    if (end >= 0) cleaned = cleaned.slice(0, end + 1);
    parsed = JSON.parse(cleaned);
  } catch {
    console.error("JSON parse failed, raw:", content.slice(0, 500));
  }
  return {
    unitTypeName: String(parsed.unitTypeName || "").trim(),
    countertops: parsed.countertops ?? [],
  };
}

function normalizeCountertop(ct: any) {
  const depth = Math.round((Number(ct.depth) || 25.5) * 2) / 2;
  let category = String(ct.category || "").toLowerCase().trim();
  if (!category || (category !== "kitchen" && category !== "bath")) {
    const label = String(ct.label || "").toLowerCase();
    if (depth <= 22 || /vanity|bath|lav|powder/.test(label)) {
      category = "bath";
    } else {
      category = "kitchen";
    }
  }
  return {
    label: String(ct.label || "Section").trim(),
    length: Math.round((Number(ct.length) || 96) * 2) / 2,
    depth,
    backsplashLength: Math.round((Number(ct.backsplashLength) || 0) * 2) / 2,
    isIsland: Boolean(ct.isIsland),
    category,
  };
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const { pageImage, provider: providerInput, dialagramModel: dialagramModelInput } = await req.json();
    const provider: "gemini" | "dialagram" = providerInput === "dialagram" ? "dialagram" : "gemini";
    const dialagramModel = String(dialagramModelInput || "qwen-3.6-plus");
    console.log(`extract-pdf-countertops provider=${provider}${provider === "dialagram" ? ` model=${dialagramModel}` : ""}`);

    if (!pageImage || typeof pageImage !== "string") {
      return new Response(JSON.stringify({ error: "pageImage (base64 string) required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const extractionPrompt = `You are an expert millwork estimator analyzing a 2020 countertop shop drawing.

TASK:
1. First, find the UNIT TYPE NAME from the drawing's title block. This is the architectural unit/plan type shown in the title block area (usually bottom-right or top of the drawing). Examples: "1.1B-AS", "TYPE A", "2BR-ADA", "BREAKROOM", "MAIL ROOM", "COMMUNITY ROOM", "STUDIO", "1BR MIRROR", etc. Extract the EXACT and COMPLETE name as it appears — do NOT abbreviate or modify it. This is critical for grouping countertops by unit type. If no title block or type name is visible, use "".

2. Then extract every countertop section visible. For each section extract:

a. **label** — a short descriptive name based on its location (e.g. "Perimeter Left", "Perimeter Right", "Island", "Peninsula", "Bar Top", "Vanity", "L-Section", "U-Section"). If the drawing has text labels, use those.
b. **length** — total linear length in inches. Read dimension labels first. If no label, estimate from the drawing.
c. **depth** — depth in inches. Read from dimension labels. Standard kitchen countertop depth is 25.5". Vanity/bath tops are typically 22" or 19" deep. Islands are often 36-42".
d. **backsplashLength** — the linear inches of WALL backsplash ONLY. This is CRITICAL — read carefully:
   - For EVERY countertop section that is against a wall, backsplash runs along the FULL wall edge.
   - KEY RULE: If a countertop section is against a wall (not an island), the backsplash length should generally EQUAL or be very close to the countertop LENGTH, because backsplash runs the entire length of the countertop along the wall.
   - For L-shaped or U-shaped runs broken into segments: each segment's backsplash = that segment's FULL length along the wall. Do NOT deduct depth at corners — backsplash is continuous along walls.
   - Look for DOUBLE LINES drawn along the WALL edge — these confirm backsplash presence.
   - Do NOT include sidesplash (short perpendicular returns at exposed ends). Sidesplash is tracked separately.
   - Islands and peninsulas typically have backsplashLength = 0 (no wall behind them).
   - If a section is clearly against a wall but you're unsure about backsplash markings, default backsplashLength to the section's length.
e. **isIsland** — true if this section is an island or peninsula (not against a wall, typically depth >= 30").
f. **category** — classify as "kitchen" or "bath". Use these rules:
   - If depth is 22" or less (19", 22", etc.) → "bath"  
   - If the label or room mentions "vanity", "bath", "bathroom", "lav", "powder" → "bath"
   - Everything else → "kitchen"

RULES:
- Look for dimension lines, annotations, and measurements in the drawing
- For L-shaped or U-shaped runs, break them into individual straight segments
- If a countertop wraps around a corner, create separate sections for each leg
- IMPORTANT for **length** (Top Inches): When breaking L/U-shaped runs at a corner, deduct the depth (e.g. 25.5") from one leg to avoid double-counting the corner overlap. This is correct for top surface area.
- IMPORTANT for **backsplashLength** (BS Inches): Do NOT deduct any depth for corners. Backsplash runs along the wall continuously — measure the FULL linear inches along the wall with NO corner deduction. Each wall-adjacent segment's backsplash = its full length.
- Do NOT include appliance surfaces (range top, sink cutout dimensions) as separate sections — they are part of the countertop run
- If the page has no countertop information, return {"unitTypeName":"","countertops":[]}
- Round all dimensions to nearest 0.5 inch
- Standard depths: perimeter = 25.5", island = 36", bar = 12-18", vanity = 22"
- The unitTypeName field is REQUIRED — always look for it in the title block
- IMPORTANT: Scan the ENTIRE page thoroughly. Do not skip any countertop sections, especially smaller segments or sections in corners of the drawing.

Return ONLY valid JSON — no markdown fences, no explanation:
{"unitTypeName":"1.1B-AS","countertops":[{"label":"Perimeter Left","length":96,"depth":25.5,"backsplashLength":96,"isIsland":false,"category":"kitchen"}]}`;

    // ── Pass 1: Extraction ──
    let extractionContent = "";
    try {
      extractionContent = await callAI(provider, pageImage, extractionPrompt, {
        temperature: 0.2,
        maxOutputTokens: 8192,
        geminiModels: PRIMARY_MODELS,
        dialagramModel,
      });
    } catch (err) {
      if (err instanceof Error && err.message === "rate_limit") {
        return new Response(JSON.stringify({ error: "rate_limit" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (err instanceof Error && err.message === "credits") {
        return new Response(JSON.stringify({ error: "credits" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (err instanceof Error && err.message === "ai_unavailable") {
        return new Response(JSON.stringify({ error: "AI model temporarily unavailable.", unitTypeName: "", countertops: [] }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      throw err;
    }

    console.log("AI countertop raw:", extractionContent.slice(0, 800));
    const extracted = parseCountertopJSON(extractionContent);
    const countertops = (extracted.countertops).map(normalizeCountertop);

    // ── Pass 2: Verification ──
    if (countertops.length > 0) {
      console.log("Starting verification pass...");
      const verifyPrompt = `You are verifying AI-extracted countertop data from a 2020 shop drawing.

Here is the extracted data:
${JSON.stringify({ unitTypeName: extracted.unitTypeName, countertops }, null, 2)}

Look at the SAME shop drawing image and verify:
1. Is the unitTypeName correct? If not, provide the correct one.
2. Are there any MISSING countertop sections that were not extracted? Add them.
3. Are the dimensions (length, depth, backsplashLength) accurate? Correct any errors.
4. Are the categories (kitchen/bath) correct?
5. Are there any DUPLICATE sections that should be removed?
6. Are any sections actually NOT countertops (e.g. appliance cutouts listed separately)?

Return the CORRECTED complete JSON — same format:
{"unitTypeName":"...","countertops":[...]}

If everything looks correct, return the data as-is. Return ONLY valid JSON — no markdown fences, no explanation.`;

      try {
        const verifyContent = await callAI(provider, pageImage, verifyPrompt, {
          temperature: 0.1,
          maxOutputTokens: 8192,
          geminiModels: VERIFY_MODELS,
          dialagramModel,
        });
        console.log("Verify countertop raw:", verifyContent.slice(0, 800));
        const verified = parseCountertopJSON(verifyContent);

        if (verified.countertops && verified.countertops.length > 0) {
          const verifiedCts = verified.countertops.map(normalizeCountertop);
          const unitTypeName = (verified.unitTypeName || extracted.unitTypeName || "").trim();
          console.log("Verified unit type:", unitTypeName, "sections:", verifiedCts.length);

          return new Response(JSON.stringify({ unitTypeName, countertops: verifiedCts }), {
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
      } catch (verifyErr) {
        console.warn("Verification pass failed, using extraction result:", verifyErr);
      }
    }

    // Fallback: return extraction result
    const unitTypeName = extracted.unitTypeName;
    console.log("Detected unit type name:", unitTypeName);

    return new Response(JSON.stringify({ unitTypeName, countertops }), {
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
