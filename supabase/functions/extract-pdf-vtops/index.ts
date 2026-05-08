import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type VtopBbox = { x: number; y: number; width: number; height: number };
type PageSide = "top" | "bottom" | "left" | "right";
type CloserEndOnPage = PageSide | "center";
type EndWallOnPage = {
  left: boolean | null;
  right: boolean | null;
  top: boolean | null;
  bottom: boolean | null;
};

type VtopRow = {
  length: number;
  depth: number;
  bowlPosition: "offset-left" | "offset-right" | "center";
  bowlOffset: number | null;
  hasSink?: boolean;
  leftWall: boolean;
  rightWall: boolean;
  bbox?: VtopBbox;
  aiLeftWallHint?: boolean;
  aiRightWallHint?: boolean;
  leftWallYesConfidence?: number;
  rightWallYesConfidence?: number;
  backSideOnPage?: PageSide;
  closerEndOnPage?: CloserEndOnPage;
  endWallOnPage?: EndWallOnPage;
  reviewRequired?: boolean;
  reviewReason?: string;
};

function normalizeEndWallOnPage(value: unknown): EndWallOnPage | undefined {
  if (!value || typeof value !== "object") return undefined;
  const v = value as Record<string, unknown>;
  const norm = (x: unknown): boolean | null => {
    if (x === true || x === "true" || x === 1) return true;
    if (x === false || x === "false" || x === 0) return false;
    return null;
  };
  return {
    left: norm(v.left),
    right: norm(v.right),
    top: norm(v.top),
    bottom: norm(v.bottom),
  };
}

type ParsedExtraction = {
  unitTypeName: string;
  vtops: VtopRow[];
};

type ModelAttempt = {
  name: string;
  retries: number;
};

const PRIMARY_MODELS: ModelAttempt[] = [
  { name: "gemini-3-flash-preview", retries: 3 },
  { name: "gemini-3-flash-preview", retries: 2 },
];

const VERIFY_MODELS: ModelAttempt[] = [
  { name: "gemini-3-flash-preview", retries: 2 },
];

function clampNorm(v: number): number {
  return Math.max(0, Math.min(1, Number(v) || 0));
}

function normalizePageSide(value: unknown): PageSide | undefined {
  const v = String(value || "").trim().toLowerCase();
  if (v === "top" || v === "bottom" || v === "left" || v === "right") return v;
  return undefined;
}

function normalizeCloserEnd(value: unknown): CloserEndOnPage | undefined {
  const v = String(value || "").trim().toLowerCase();
  if (v === "center") return "center";
  return normalizePageSide(v);
}

function resolveBowlPositionFromPageSides(
  backSideOnPage?: PageSide,
  closerEndOnPage?: CloserEndOnPage,
): "offset-left" | "offset-right" | "center" | undefined {
  if (!backSideOnPage || !closerEndOnPage) return undefined;
  if (closerEndOnPage === "center") return "center";

  if (backSideOnPage === "top") {
    if (closerEndOnPage === "left") return "offset-left";
    if (closerEndOnPage === "right") return "offset-right";
  }
  if (backSideOnPage === "bottom") {
    if (closerEndOnPage === "left") return "offset-right";
    if (closerEndOnPage === "right") return "offset-left";
  }
  if (backSideOnPage === "left") {
    if (closerEndOnPage === "top") return "offset-right";
    if (closerEndOnPage === "bottom") return "offset-left";
  }
  if (backSideOnPage === "right") {
    if (closerEndOnPage === "top") return "offset-left";
    if (closerEndOnPage === "bottom") return "offset-right";
  }

  return undefined;
}

function normalizeVtop(vt: any): VtopRow {
  const length = Math.round((Number(vt?.length) || 31) * 4) / 4;
  const depth = Math.round((Number(vt?.depth) || 22) * 4) / 4;
  const backSideOnPage = normalizePageSide(vt?.backSideOnPage);
  const closerEndOnPage = normalizeCloserEnd(vt?.closerEndOnPage);
  const resolvedBowlPosition = resolveBowlPositionFromPageSides(backSideOnPage, closerEndOnPage);
  const bowlPosition = resolvedBowlPosition || (["offset-left", "offset-right", "center"].includes(vt?.bowlPosition)
    ? vt.bowlPosition
    : "center");
  const bowlOffset = bowlPosition !== "center"
    ? Math.round((Number(vt?.bowlOffset) || 0) * 4) / 4
    : null;
  const hasSink = vt?.hasSink === false
    ? false
    : bowlPosition !== "center" || bowlOffset != null || Boolean(vt?.hasSink);

  const aiLeft = Boolean(vt?.leftWall);
  const aiRight = Boolean(vt?.rightWall);

  const row: VtopRow = {
    length,
    depth,
    bowlPosition,
    bowlOffset,
    hasSink,
    leftWall: aiLeft,
    rightWall: aiRight,
    aiLeftWallHint: aiLeft,
    aiRightWallHint: aiRight,
    leftWallYesConfidence: Math.max(0, Math.min(1, Number(vt?.leftWallYesConfidence) || 0.5)),
    rightWallYesConfidence: Math.max(0, Math.min(1, Number(vt?.rightWallYesConfidence) || 0.5)),
    backSideOnPage,
    closerEndOnPage,
  };

  if (vt?.bbox && typeof vt.bbox === "object") {
    row.bbox = {
      x: clampNorm(vt.bbox.x),
      y: clampNorm(vt.bbox.y),
      width: clampNorm(vt.bbox.width),
      height: clampNorm(vt.bbox.height),
    };
    if (row.bbox.width < 0.01 || row.bbox.height < 0.01) {
      row.bbox = undefined;
    }
  }

  return row;
}

function parseExtractionText(content: string): ParsedExtraction {
  let parsed: { unitTypeName?: string; vtops?: any[] } = {};
  try {
    let cleaned = content
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();

    const starts = [cleaned.indexOf('{"unitTypeName"'), cleaned.indexOf('{"vtops"')].filter(i => i >= 0);
    const start = starts.length > 0 ? Math.min(...starts) : cleaned.indexOf("{");
    if (start >= 0) cleaned = cleaned.slice(start);

    const end = cleaned.lastIndexOf("}");
    if (end >= 0) cleaned = cleaned.slice(0, end + 1);

    parsed = JSON.parse(cleaned);
  } catch {
    console.error("JSON parse failed, raw:", content.slice(0, 500));
  }

  return {
    unitTypeName: String(parsed.unitTypeName || "").trim(),
    vtops: Array.isArray(parsed.vtops) ? parsed.vtops.map(normalizeVtop) : [],
  };
}

function parseWallConfidence(content: string): { leftWallYesConfidence: number; rightWallYesConfidence: number } {
  try {
    let cleaned = content
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/```\s*$/i, "")
      .trim();
    const start = cleaned.indexOf("{");
    const end = cleaned.lastIndexOf("}");
    if (start >= 0 && end > start) cleaned = cleaned.slice(start, end + 1);
    const parsed = JSON.parse(cleaned);
    return {
      leftWallYesConfidence: Math.max(0, Math.min(1, Number(parsed?.leftWallYesConfidence) || 0.5)),
      rightWallYesConfidence: Math.max(0, Math.min(1, Number(parsed?.rightWallYesConfidence) || 0.5)),
    };
  } catch {
    return { leftWallYesConfidence: 0.5, rightWallYesConfidence: 0.5 };
  }
}

function sanitizeDetectedType(value: unknown): string {
  const raw = String(value || "").trim();
  if (!raw) return "";
  if (/^(unknown|n\/?a|none|null|empty|tbd|untitled)$/i.test(raw)) return "";
  return raw.replace(/^['"]+|['"]+$/g, "").replace(/\s+/g, " ").trim();
}

function extractUnitTypeFromPageText(text: string): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";

  const patterns = [
    // "TYPE 1.1A (ADA) UNIT# ..." or "PARCEL X TYPE ... UNIT#"
    /(?:parcel\s+[a-z0-9]+(?:\s+[a-z0-9]+)*\s+)?type\s*-?\s*([a-z0-9().\/-]+(?:\s+[a-z0-9().\/-]+){0,4})\s+unit#/i,
    /countertops\s+type\s*-?\s*([a-z0-9().\/-]+(?:\s+[a-z0-9().\/-]+){0,4})\s+(?:parcel|unit#)/i,
    // "Judd Homestead - CT 1BR-1 (ADA) - AS UNIT# BLDG ..." (no "TYPE" keyword)
    /(?:^|[\s-])((?:\d+br|studio|efficiency|penthouse)[a-z0-9().\/\s-]{0,40}?)\s+unit#/i,
    // Community-building room labels right before "Countertops Drawing #"
    /(powder\s*room|unisex\s*bath|half\s*bath|bath(?:room)?|lav(?:atory)?|restroom|wc|vanity)\s+countertops\s+drawing\s*#/i,
    // Footer: "<NAME> Countertops Drawing #: 1 No Scale."
    /([a-z0-9][a-z0-9().\/\s-]{1,60}?)\s+countertops\s+drawing\s*#/i,
    // Generic: "Countertops <NAME> <dim>"
    /countertops\s+([a-z][a-z0-9().\/-]*(?:\s+[a-z0-9().\/-]+){0,4})\s+(?:\d+(?:\s+\d+\s+\d+)?\s*"|parcel\s+[a-z0-9]+|type\s+-?)/i,
  ];

  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    if (!match) continue;
    let candidate = sanitizeDetectedType(match[1]);
    // Strip leading "Judd Homestead - CT " or other project preamble
    candidate = candidate.replace(/^(?:judd\s+homestead\s*-?\s*ct\s*-?\s*)/i, "").trim();
    // Strip trailing "Drawing #" remnants
    candidate = candidate.replace(/\s*(?:no\s+scale|drawing\s*#?.*)$/i, "").trim();
    if (candidate && candidate.length >= 2 && candidate.length <= 60) return candidate;
  }

  return "";
}

function parseFractionalNumber(value: string): number | null {
  const cleaned = value.trim().replace(/\s+/g, " ");
  const mixed = cleaned.match(/^(\d+)\s+(\d+)\/(\d+)$/);
  if (mixed) return Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]);
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function extractDimensionsFromHintText(text: string): number[] {
  const normalized = text
    .replace(/\s+/g, " ")
    .replace(/(\d+)\s*"\s*([1357])\s+([248])/g, "$1 $2/$3\"")
    .replace(/(\d+)\s+([1357])\s+([248])\s*"/g, "$1 $2/$3\"");

  const values: number[] = [];
  const regex = /(\d+(?:\.\d+)?(?:\s+\d\/\d)?)\s*"/g;
  for (const match of normalized.matchAll(regex)) {
    const parsed = parseFractionalNumber(match[1]);
    if (parsed != null && parsed >= 12 && parsed <= 240) {
      values.push(Math.round(parsed * 4) / 4);
    }
  }
  return values;
}

const VANITY_DEPTH_MIN = 17.5;
const VANITY_DEPTH_MAX = 22.5;

function hasBathroomContext(text: string): boolean {
  return /\b(vanity|lav(?:atory)?|bath(?:room)?|powder(?:\s*room)?|restroom|wc|unisex\s*bath|half\s*bath)\b/i.test(text);
}

function hasExcludedCounterContext(text: string): boolean {
  return /\b(kitchen|break\s*room|mail\s*room|community(?:\s*(?:room|building))?|island|pantry|bar\s*top|bartop|corridor|hallway|work\s*station|workstation|lobby|lounge|reception|cafe|coffee|nurse\s*station|laundry|janitor)\b/i.test(text);
}

function isVanityDepth(depth: number): boolean {
  return Number.isFinite(depth) && depth >= VANITY_DEPTH_MIN && depth <= VANITY_DEPTH_MAX;
}

function isVanityCandidate(row: VtopRow, unitTypeName: string, pageTextHint: string): boolean {
  const context = `${unitTypeName} ${pageTextHint}`.trim();
  const bathroomContext = hasBathroomContext(context);
  const excludedContext = hasExcludedCounterContext(context);
  const sinkEvidence = Boolean(row.hasSink) || row.bowlOffset != null || row.bowlPosition !== "center";

  // Hard depth gate — vanities are 22" or less.
  if (!isVanityDepth(row.depth)) return false;

  // Exclude rooms that are clearly not bathrooms — even if they have a sink (kitchen, break room, etc.)
  // unless the page also explicitly mentions a bathroom (multi-room pages like "2BR (ADA)" with kitchen + Bath-1 + Bath-2).
  if (excludedContext && !bathroomContext) return false;

  // Require sink evidence OR clear bathroom context. A naked rectangle with no bowl
  // and no bathroom keywords is NOT a vanity.
  if (sinkEvidence) return true;
  if (bathroomContext) return true;
  return false;
}

function filterVanityCandidates(rows: VtopRow[], unitTypeName: string, pageTextHint: string): VtopRow[] {
  return rows.filter((row) => isVanityCandidate(row, unitTypeName, pageTextHint));
}

function buildTextFallbackVtops(pageTextHint: string, hintedUnitTypeName: string): ParsedExtraction {
  const normalized = pageTextHint.replace(/\s+/g, " ").trim();
  const hasVanityKeywords = hasBathroomContext(`${hintedUnitTypeName} ${normalized}`);
  const dims = extractDimensionsFromHintText(normalized);
  if (dims.length < 2) {
    return { unitTypeName: hintedUnitTypeName, vtops: [] };
  }

  const depthCandidates = dims.filter((v) => isVanityDepth(v));
  const depth = depthCandidates.length > 0 ? Math.min(...depthCandidates) : null;
  if (!depth) {
    return { unitTypeName: hintedUnitTypeName, vtops: [] };
  }

  const lengthCandidates = dims.filter((v) => v > depth && v >= 18 && v <= 120);
  const length = lengthCandidates.length > 0 ? Math.max(...lengthCandidates) : null;

  if (!Number.isFinite(length) || !Number.isFinite(depth) || !length || length <= depth || !hasVanityKeywords) {
    return { unitTypeName: hintedUnitTypeName, vtops: [] };
  }

  return {
    unitTypeName: hintedUnitTypeName,
    vtops: [{
      length: Math.round(length * 4) / 4,
      depth: Math.round(depth * 4) / 4,
      bowlPosition: "center",
      bowlOffset: null,
      hasSink: false,
      leftWall: true,
      rightWall: true,
      leftWallYesConfidence: 0.6,
      rightWallYesConfidence: 0.6,
    }],
  };
}

async function requestGemini(
  apiKey: string,
  images: Array<{ mimeType: string; data: string }>,
  prompt: string,
  models: ModelAttempt[],
  generationConfig: { temperature: number; maxOutputTokens: number },
): Promise<string> {
  let response: Response | null = null;

  const imageParts = images.map(img => ({
    inlineData: { mimeType: img.mimeType, data: img.data },
  }));

  for (const { name: model, retries } of models) {
    console.log(`Trying model: ${model} (${retries} attempts)`);
    let succeeded = false;

    for (let attempt = 0; attempt < retries; attempt++) {
      try {
        response = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [{
                role: "user",
                parts: [
                  ...imageParts,
                  { text: prompt },
                ],
              }],
              generationConfig,
            }),
          },
        );
      } catch (fetchErr) {
        console.error(`AI fetch error (${model}, attempt ${attempt + 1}):`, fetchErr);
        if (attempt < retries - 1) {
          await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
          continue;
        }
        response = null;
        break;
      }

      if (response.status === 429) throw new Error("rate_limit");
      if (response.status === 402) throw new Error("credits");

      if (response.status === 503 || response.status === 500) {
        console.warn(`AI unavailable (${response.status}) for ${model}, attempt ${attempt + 1}/${retries}`);
        response = null;
        if (attempt < retries - 1) {
          await new Promise(r => setTimeout(r, 2000 * (attempt + 1)));
          continue;
        }
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
  images: Array<{ mimeType: string; data: string }>,
  prompt: string,
  model: string,
  temperature: number,
  maxTokens: number,
): Promise<string> {
  const MAX_RETRIES = 3;
  const imageParts = images.map((img) => ({
    type: "image_url" as const,
    image_url: { url: `data:${img.mimeType};base64,${img.data}` },
  }));

  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    if (attempt === 0) {
      const totalBytes = images.reduce((s, i) => s + i.data.length, 0);
      console.log(`Dialagram request: model=${model}, images=${images.length}, total base64 bytes=${totalBytes}`);
    }
    let response: Response;
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
              role: "system",
              content: "You are a vision AI that analyzes architectural shop drawings provided as images. Always examine the attached image(s) carefully before responding. Never ask the user to upload an image — the images are always attached.",
            },
            {
              role: "user",
              content: [{ type: "text", text: prompt }, ...imageParts],
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

  if (trimmed.startsWith("{")) {
    try {
      const data = JSON.parse(trimmed);
      return data.choices?.[0]?.message?.content ?? "";
    } catch (err) {
      console.error("Dialagram JSON parse failed:", err, "raw:", trimmed.slice(0, 300));
      throw new Error("ai_unavailable");
    }
  }

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
        // skip non-JSON SSE lines
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
  images: Array<{ mimeType: string; data: string }>,
  prompt: string,
  opts: { temperature: number; maxOutputTokens: number; geminiModels: ModelAttempt[]; dialagramModel: string },
): Promise<string> {
  if (provider === "dialagram") {
    const key = Deno.env.get("DIALAGRAM_API_KEY");
    if (!key) throw new Error("DIALAGRAM_API_KEY not configured");
    return requestDialagram(key, images, prompt, opts.dialagramModel, opts.temperature, opts.maxOutputTokens);
  }
  const key = Deno.env.get("GEMINI_API_KEY");
  if (!key) throw new Error("GEMINI_API_KEY not configured");
  return requestGemini(key, images, prompt, opts.geminiModels, { temperature: opts.temperature, maxOutputTokens: opts.maxOutputTokens });
}
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: corsHeaders });
  }

  try {
    const body = await req.json();
    const {
      pageImage,
      pageImageMimeType,
      focusedWallDetection,
      rightEndCrop,
      provider: providerInput,
      dialagramModel: dialagramModelInput,
      pageTextHint,
      unitTypeNameHint,
    } = body;
    const provider: "gemini" | "dialagram" = providerInput === "dialagram" ? "dialagram" : "gemini";
    const dialagramModel = String(dialagramModelInput || "qwen-3.6-plus");
    const imageMime = String(pageImageMimeType || "image/jpeg").trim() || "image/jpeg";
    const normalizedPageTextHint = String(pageTextHint || "").trim();
    const hintedUnitTypeName = sanitizeDetectedType(unitTypeNameHint) || extractUnitTypeFromPageText(normalizedPageTextHint);
    console.log(`extract-pdf-vtops provider=${provider}${provider === "dialagram" ? ` model=${dialagramModel}` : ""} mime=${imageMime}`);

    if (!pageImage || typeof pageImage !== "string") {
      return new Response(JSON.stringify({ error: "pageImage (base64 string) required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // ── Mode 2: Focused wall detection on end crops ──
    if (focusedWallDetection && rightEndCrop) {
      console.log("Focused wall detection mode");
      const focusedPrompt = `You are analyzing two cropped images of the left and right ends of a vanity top from a 2020 countertop shop drawing.

TASK: Determine if each end has a WALL (double line / sidesplash) or is OPEN (single line / finish end).

Image 1 = LEFT end of the vanity
Image 2 = RIGHT end of the vanity

Wall indicators:
- Double parallel lines at the edge = WALL (sidesplash needed)
- Single line at the edge = OPEN (finish end needed)
- A wall adjacent to the vanity = WALL

Return ONLY valid JSON:
{"leftWallYesConfidence":0.85,"rightWallYesConfidence":0.2}

leftWallYesConfidence: probability 0.0-1.0 that the LEFT end has a wall
rightWallYesConfidence: probability 0.0-1.0 that the RIGHT end has a wall`;

      try {
        const content = await callAI(
          provider,
          [
            { mimeType: "image/png", data: pageImage },
            { mimeType: "image/png", data: rightEndCrop },
          ],
          focusedPrompt,
          {
            temperature: 0.1,
            maxOutputTokens: 256,
            geminiModels: [{ name: "gemini-3-flash-preview", retries: 2 }],
            dialagramModel,
          },
        );
        console.log("Focused wall raw:", content);
        const result = parseWallConfidence(content);
        return new Response(JSON.stringify(result), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      } catch (err) {
        if (err instanceof Error && err.message === "rate_limit") {
          return new Response(JSON.stringify({ error: "rate_limit" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        }
        return new Response(JSON.stringify({ leftWallYesConfidence: 0.5, rightWallYesConfidence: 0.5 }), {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
    }

    // ── Mode 1: Full-page extraction (dimensions, bbox, rough wall hints) ──
    // Provider-specific prompt: Qwen handles short, direct prompts much better than long
    // multi-rule prompts. Gemini benefits from the detailed perspective rules.
    const geminiPrompt = `You are an expert millwork estimator analyzing a 2020 countertop shop drawing page.

TASK:
1. Find the UNIT TYPE NAME from the drawing's title block (usually bottom-right or top). Examples: "TYPE 1.1A (ADA)", "TYPE 2.1B-AS", "STUDIO", etc. Extract the EXACT and COMPLETE name. If none visible, use "".

2. Extract ONLY vanity tops (bathroom tops). NEVER extract kitchen countertops, corridor counters, work-station desks, break/community/mail room counters, or any top deeper than 22.5". A vanity top is identified by ALL of:
   - Depth of 17.5" to 22.5" (usually 22") — STRICT, never 25"+ or 24"
   - A ROUND or OVAL bowl cutout drawn inside the rectangle (NOT square or rectangular — that is a kitchen sink)
   - Located in a room labeled bath / vanity / lav / powder / unisex bath / Bath-1 / Bath-2 etc.
   A page can contain BOTH a kitchen run AND a separate vanity (e.g. 1BR-1 (ADA) pages). Return ONLY the vanity piece.
   A page can contain MULTIPLE vanities (e.g. 2BR (ADA) → Bath-1 and Bath-2). Return ALL of them.

3. For EACH vanity top, extract:
   a. **length** — total length in inches (e.g., 47.5, 31, 25)
   b. **depth** — depth in inches (usually 22")
   c. **backSideOnPage** — which PAGE SIDE contains the backsplash / back edge (double line along the long edge). Must be exactly one of: "top", "bottom", "left", "right".
   d. **closerEndOnPage** — which PAGE SIDE contains the SHORTER bowl-center dimension along the LENGTH axis. Must be exactly one of: "top", "bottom", "left", "right", or "center".
   e. **bowlPosition** — determine left vs right FROM THE PERSPECTIVE OF A PERSON STANDING IN FRONT OF THE VANITY, FACING IT.
      CRITICAL PERSPECTIVE RULE:
        1. The BACKSPLASH / WALL (double line along the long edge) is BEHIND the vanity — this is the BACK.
        2. Imagine a person standing in FRONT of the vanity (opposite the backsplash), facing toward it.
        3. LEFT and RIGHT are from THIS person's perspective.
        4. Find the dimension callouts showing distance from each end of the LENGTH axis to the bowl center.
        5. The end with the SHORTER dimension is the side the bowl is offset toward.
        6. Use backSideOnPage + closerEndOnPage consistently to determine bowlPosition.
      ORIENTATION HANDLING — DO NOT ASSUME. ALWAYS LOCATE THE ACTUAL DOUBLE-LINE WALL FIRST:
        - The backsplash/wall is the LONG edge that has TWO PARALLEL LINES drawn close together (the double line). The opposite long edge is a SINGLE line — that is the FRONT.
        - Dimension callouts (length/offset numbers) can appear on EITHER side of the rectangle. DO NOT use dimension-line position to infer where the back is — use the DOUBLE LINE only.
        - If the vanity is drawn HORIZONTALLY (wider than tall on page):
            • If double-line is on PAGE TOP → backSideOnPage="top". Person stands at PAGE BOTTOM facing UP. Person LEFT = PAGE LEFT, Person RIGHT = PAGE RIGHT.
            • If double-line is on PAGE BOTTOM → backSideOnPage="bottom". Person stands at PAGE TOP facing DOWN. Person LEFT = PAGE RIGHT, Person RIGHT = PAGE LEFT (MIRRORED).
        - If the vanity is drawn VERTICALLY (taller than wide on page):
            • If double-line is on PAGE RIGHT → backSideOnPage="right". Person stands on PAGE LEFT. Person LEFT = PAGE TOP, Person RIGHT = PAGE BOTTOM.
            • If double-line is on PAGE LEFT → backSideOnPage="left". Person stands on PAGE RIGHT. Person LEFT = PAGE BOTTOM, Person RIGHT = PAGE TOP.
        - CRITICAL: When backSideOnPage is "bottom" or "right", the person/page mapping IS MIRRORED — the smaller dimension being on PAGE LEFT means the bowl is offset-RIGHT (not offset-left).
      - "offset-left" if bowl is closer to the person's LEFT end
      - "offset-right" if bowl is closer to the person's RIGHT end
      - "center" if bowl is centered along the length axis
   f. **bowlOffset** — if offset, measure the distance in inches from the CLOSER end to the center of the bowl. If center, set to null.
   g. **leftWall** and **rightWall** — CRITICAL: Detect whether each end of the vanity top has a wall, using the SAME "person standing in front" perspective.
      leftWall = wall on the person's LEFT end. rightWall = wall on the person's RIGHT end.

RULES FOR WALL DETECTION (leftWall / rightWall):
- Use the SAME "person standing in front" perspective as bowlPosition.
- Look at EACH END of the vanity top along its LENGTH axis — judge each end INDEPENDENTLY.
- WALL (true) — set true ONLY when you can clearly see at that end:
  * DOUBLE PARALLEL LINES at the end edge (two lines close together = sidesplash / wall return)
  * A WALL LINE drawn adjacent to and touching the vanity end (hatched wall, thicker line)
  * An explicit sidesplash/backsplash return drawn at that end
  * Text labels like "SS" (sidesplash), "WALL", or wall hatching at the end
- OPEN / NO WALL (false) — set false when at that end you see:
  * A SINGLE LINE at the end edge (just the vanity outline = finish end / open end)
  * The vanity end is free-standing with no wall structure adjacent
  * Text labels like "FE" (finish end) or "OPEN"
- IMPORTANT: It is VERY COMMON for one end to have a wall (double line / sidesplash) while the OTHER end is a finish end (single line). Do NOT assume both ends match.
- Examples: a 32"x22" vanity with the bowl drawn against the LEFT side of the rectangle and a clear single line on the LEFT edge but a double line on the RIGHT edge = leftWall:false, rightWall:true (Left end finish + Right side sidesplash).
- DO NOT default to true. Only set wall=true when you actually see double-line / wall evidence at that specific end.
- Set leftWallYesConfidence and rightWallYesConfidence to your actual certainty (0.0=clearly single line / open, 1.0=clearly double line / wall, 0.5=truly ambiguous).

RULES FOR BOWL POSITION:
- ALWAYS use dimension callout lines to determine offset — do not guess from visual position alone.
- Look for dimension lines showing the distance from the vanity edge to the bowl centerline.
- The SMALLER dimension value indicates which end the bowl is offset toward.
- If the drawing shows a measurement like "17 3/4\"" from one side and "29 3/4\"" from the other, the bowl is offset toward the 17 3/4" side.
- If both sides have equal dimensions to the bowl center, it's "center".
- Convert fractions to decimals: 3/4 = 0.75, 1/2 = 0.5, 1/4 = 0.25, 3/8 = 0.375
- For TYPE 1.1B-AS style vertical views: if the backsplash double-line is on PAGE LEFT and the shorter offset dimension (17.75") is from PAGE BOTTOM, the correct answer is backSideOnPage="left", closerEndOnPage="bottom", bowlPosition="offset-left".

IMPORTANT:
- Only extract vanity/bathroom tops. Skip ALL kitchen countertops (depth > 22").
- If the page has no vanity tops, return {"unitTypeName":"","vtops":[]}
- Round all dimensions to nearest 0.25 inch.
- The bbox coordinates MUST be normalized 0..1 relative to the full page.

Return ONLY valid JSON — no markdown fences, no explanation:
{"unitTypeName":"TYPE 1.1A (ADA)","vtops":[{"length":47.5,"depth":22,"backSideOnPage":"left","closerEndOnPage":"bottom","bowlPosition":"offset-left","bowlOffset":17.75,"leftWall":true,"rightWall":true,"leftWallYesConfidence":0.9,"rightWallYesConfidence":0.85,"bbox":{"x":0.05,"y":0.3,"width":0.35,"height":0.2}}]}`;

    // QWEN PROMPT: short, direct, but STRICTLY vanity-only.
    // We still keep it concise for Qwen stability, but do not allow kitchen/community/mail counters.
    const qwenPrompt = `Look at this 2020 countertop shop drawing page and extract ONLY VANITY TOPS / LAVATORY TOPS.

STRICT RULES — a top counts as a vanity top ONLY when ALL of these are true:
1. Depth (shorter edge) is BETWEEN 17.5" AND 22.5" inclusive (usually 22"). NEVER 25"+, NEVER 24".
2. The drawing shows a ROUND or OVAL bowl/sink cutout inside the rectangle (an oval/ellipse, NOT a square or rounded-rectangle sink — square/rectangular cutouts are kitchen sinks).
3. The room/page is a bathroom-type space: vanity, bath, powder, lav, lavatory, unisex bath, half bath, Bath-1, Bath-2, etc.

EXPLICIT EXCLUSIONS — never return these even if they fit on the page:
- Kitchen counters (depth ~25.25", square sink, "KITCHEN" label)
- Corridor counters / shelves (no sink)
- Work station / workstation desks (no sink)
- Break room / community room / mail room / lobby / reception / nurse station / coffee bar / bartop / island
- Anything deeper than 22.5"
- Anything with a SQUARE or RECTANGULAR sink cutout (kitchen)

A page can contain BOTH a kitchen run AND a separate small vanity (e.g. 1BR-1 (ADA) pages have a 25.5" deep L-shape kitchen plus a separate ~44.5" x 22" vanity with an oval bowl). Return ONLY the vanity piece, NEVER the kitchen run.

A page can contain MULTIPLE vanities (e.g. 2BR (ADA) has Bath-1 AND Bath-2). Return ALL of them as separate items.

For each vanity top return:
- length: longer edge in inches
- depth: shorter edge in inches (must be 17.5–22.5)
- hasSink: true (must be true — vanities always have an oval bowl)
- backSideOnPage: page side containing the backsplash / double line along the LONG edge: "top" | "bottom" | "left" | "right"
- closerEndOnPage: page side containing the shorter bowl-center dimension along the LENGTH axis: "top" | "bottom" | "left" | "right" | "center"
- bowlPosition: "offset-left" | "offset-right" | "center"
- bowlOffset: number or null
- leftWall/rightWall use the perspective of a person standing in FRONT of the vanity, facing the backsplash. If backSideOnPage="left", person LEFT is page BOTTOM and person RIGHT is page TOP. If backSideOnPage="right", person LEFT is page TOP and person RIGHT is page BOTTOM.
- leftWall: true ONLY if the person's LEFT end clearly shows a double parallel line / wall return / sidesplash. false if it shows a single line (finish end). Judge independently.
- rightWall: true ONLY if the person's RIGHT end clearly shows a double parallel line / wall return / sidesplash. false if it shows a single line (finish end). Judge independently. It is common for ONE end to be walled and the other to be a finish end — do NOT assume both match.

Also extract unitTypeName from the title block — use the room/unit label (e.g. "POWDER ROOM", "UNISEX BATH", "1BR-1 (ADA) - AS", "2BR (ADA)"). If the page only shows kitchen/corridor/work-station/community counters with no oval-bowl vanity, return {"unitTypeName":"","vtops":[]}.

Return ONLY valid JSON:
{"unitTypeName":"1BR-1 (ADA) - AS","vtops":[{"length":44.5,"depth":22,"hasSink":true,"backSideOnPage":"left","closerEndOnPage":"bottom","bowlPosition":"offset-left","bowlOffset":16,"leftWall":false,"rightWall":true}]} `;

    const fullPrompt = provider === "dialagram" ? qwenPrompt : geminiPrompt;

    // ── Pass 1: Extraction ──
    let fullContent = "";
    try {
      fullContent = await callAI(
        provider,
        [{ mimeType: imageMime, data: pageImage }],
        fullPrompt,
        {
          temperature: provider === "dialagram" ? 0.2 : 0.1,
          maxOutputTokens: 4096,
          geminiModels: PRIMARY_MODELS,
          dialagramModel,
        },
      );
    } catch (err) {
      if (err instanceof Error && err.message === "rate_limit") {
        return new Response(JSON.stringify({ error: "rate_limit" }), { status: 429, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (err instanceof Error && err.message === "credits") {
        return new Response(JSON.stringify({ error: "credits" }), { status: 402, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      if (err instanceof Error && err.message === "ai_unavailable") {
        return new Response(JSON.stringify({ error: "AI model temporarily unavailable.", unitTypeName: "", vtops: [] }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      throw err;
    }

    console.log("AI vtop raw:", fullContent.slice(0, 800));

    const fullParsed = parseExtractionText(fullContent);
    const extractedUnitTypeName = fullParsed.unitTypeName;
    console.log("Detected unit type name:", extractedUnitTypeName);

    let finalVtops = filterVanityCandidates(fullParsed.vtops, extractedUnitTypeName || hintedUnitTypeName, normalizedPageTextHint);
    let finalUnitTypeName = sanitizeDetectedType(extractedUnitTypeName) || hintedUnitTypeName;

    // ── Qwen rescue pass: retry only for vanity-depth/sink-bearing tops, never general counters. ──
    if (provider === "dialagram" && finalVtops.length === 0) {
      console.log("Qwen returned no vanity tops — running rescue pass with stricter vanity prompt...");
      const rescuePrompt = `This page is from a countertop shop drawing. Extract ONLY vanity / lavatory tops.

A result counts only if:
- depth is 18" to 22.5" (usually 19" or 22")
- and it shows a sink/bowl cutout, OR the page clearly indicates bathroom/vanity/lavatory use
- do NOT include kitchen, break room, mail room, community room, island, or other general counters

For each vanity top return:
- length
- depth
- hasSink
- backSideOnPage: page side with the backsplash / double line along the long edge ("top","bottom","left","right")
- closerEndOnPage: page side with the shorter bowl-center dimension along the length axis ("top","bottom","left","right","center")
- bowlPosition: "center" | "offset-left" | "offset-right"
- bowlOffset
- leftWall/rightWall from the person-standing-in-front perspective; double-line end = wall/sidesplash, single-line end = finish end.

Return ONLY valid JSON:
{"unitTypeName":"Type 1.1A","vtops":[{"length":47.5,"depth":22,"hasSink":true,"backSideOnPage":"left","closerEndOnPage":"bottom","bowlPosition":"offset-left","bowlOffset":17.75,"leftWall":false,"rightWall":true}]}`;

      try {
        const rescueContent = await callAI(
          "dialagram",
          [{ mimeType: imageMime, data: pageImage }],
          rescuePrompt,
          { temperature: 0.2, maxOutputTokens: 2048, geminiModels: PRIMARY_MODELS, dialagramModel },
        );
        console.log("Qwen rescue raw:", rescueContent.slice(0, 800));
        const rescueParsed = parseExtractionText(rescueContent);
        const rescuedVtops = filterVanityCandidates(rescueParsed.vtops, rescueParsed.unitTypeName || finalUnitTypeName, normalizedPageTextHint);
        if (rescuedVtops.length > 0) {
          finalVtops = rescuedVtops;
          if (rescueParsed.unitTypeName) finalUnitTypeName = rescueParsed.unitTypeName;
          console.log("Qwen rescue recovered", finalVtops.length, "vanity top(s)");
        }
      } catch (rescueErr) {
        console.warn("Qwen rescue pass failed:", rescueErr);
      }
    }

    if (finalVtops.length === 0 && normalizedPageTextHint) {
      const fallback = buildTextFallbackVtops(normalizedPageTextHint, finalUnitTypeName || hintedUnitTypeName);
      if (fallback.vtops.length > 0) {
        finalVtops = filterVanityCandidates(fallback.vtops, fallback.unitTypeName || finalUnitTypeName, normalizedPageTextHint);
        finalUnitTypeName = fallback.unitTypeName || finalUnitTypeName;
        console.log("Text fallback recovered", finalVtops.length, "vtop(s) from PDF text hint");
      }
    }

    // ── Pass 2: Verification (Gemini only — Qwen handles the long verify prompt poorly) ──
    if (provider === "gemini" && finalVtops.length > 0) {
      console.log("Starting vtop verification pass...");
        const verifyPrompt = `You are verifying AI-extracted vanity top data from a 2020 shop drawing.

Here is the extracted data:
${JSON.stringify({ unitTypeName: extractedUnitTypeName, vtops: finalVtops }, null, 2)}

Look at the SAME shop drawing image and verify EACH item carefully:
1. Is the unitTypeName correct? If not, provide the correct one.
2. Are the dimensions (length, depth) accurate? Correct any errors.
3. **CRITICAL — RE-CHECK bowlPosition using "person standing in front" perspective:**
   - Find the BACKSPLASH — it is the long edge with TWO PARALLEL LINES (double line) drawn close together. The opposite long edge is a SINGLE line (the front).
   - DO NOT use dimension-callout placement to infer which side is the back. Use ONLY the double line.
   - Return that as backSideOnPage = "top" | "bottom" | "left" | "right".
   - Find which PAGE SIDE has the SHORTER bowl-center dimension along the LENGTH axis.
   - Return that as closerEndOnPage = "top" | "bottom" | "left" | "right" | "center".
   - Then map to bowlPosition using the person-in-front perspective:
       • backSideOnPage="top"    → person LEFT=page LEFT,  RIGHT=page RIGHT (NOT mirrored)
       • backSideOnPage="bottom" → person LEFT=page RIGHT, RIGHT=page LEFT  (MIRRORED — smaller dim on page-left = offset-RIGHT)
       • backSideOnPage="left"   → person LEFT=page BOTTOM, RIGHT=page TOP
       • backSideOnPage="right"  → person LEFT=page TOP,    RIGHT=page BOTTOM
   - Worked example: horizontal 47.5"x22" vanity, double-line wall along the BOTTOM long edge, dimensions "17 3/4"" on page-LEFT and "29 3/4"" on page-RIGHT. backSideOnPage="bottom", closerEndOnPage="left" (page), but because back-is-bottom MIRRORS the view, bowlPosition MUST be "offset-right" with bowlOffset=17.75.
   - IMPORTANT vertical rule: if backSideOnPage="right" and closerEndOnPage="top", bowlPosition MUST be "offset-left".
4. Is the bowlOffset value accurate?
5. Are there any MISSING vanity tops not extracted? Add them.
6. Are there any FALSE vanity tops (actually kitchen countertops with depth > 22")? Remove them.

7. **CRITICAL — RE-CHECK WALL DETECTION using the SAME "person standing in front" perspective:**
   - leftWall = wall on the person's LEFT end. rightWall = wall on the person's RIGHT end.
   - DOUBLE LINES at an end = WALL (sidesplash). Set leftWall/rightWall to true.
   - SINGLE LINE at an end = OPEN (finish end). Set leftWall/rightWall to false.
   - Do NOT default to both walls. A single line at an end means finish end / no sidesplash.
   - Only set true when you see a CLEAR double line or wall return at that specific end.
   - It is common for one end to be finish end and the other end to need a sidesplash.
   - Update leftWallYesConfidence and rightWallYesConfidence accordingly.

Return the CORRECTED complete JSON — same format:
{"unitTypeName":"...","vtops":[...]}

If everything looks correct, return the data as-is. Return ONLY valid JSON — no markdown fences, no explanation.`;

      try {
        const verifyContent = await callAI(
          provider,
          [{ mimeType: imageMime, data: pageImage }],
          verifyPrompt,
          {
            temperature: 0.1,
            maxOutputTokens: 4096,
            geminiModels: VERIFY_MODELS,
            dialagramModel,
          },
        );
        console.log("Verify vtop raw:", verifyContent.slice(0, 800));
        const verified = parseExtractionText(verifyContent);

        if (verified.vtops && verified.vtops.length > 0) {
          finalVtops = verified.vtops;
          finalUnitTypeName = (verified.unitTypeName || extractedUnitTypeName).trim();
          console.log("Verified vtop unit type:", finalUnitTypeName, "vtops:", finalVtops.length);
        }
      } catch (verifyErr) {
        console.warn("Vtop verification pass failed, using extraction result:", verifyErr);
      }
    }

    finalVtops = filterVanityCandidates(finalVtops, finalUnitTypeName, normalizedPageTextHint);

    const vtops = finalVtops.map(row => ({
      ...row,
      leftWallYesConfidence: row.leftWallYesConfidence ?? 0.5,
      rightWallYesConfidence: row.rightWallYesConfidence ?? 0.5,
      sidesplashCount: (row.leftWall ? 1 : 0) + (row.rightWall ? 1 : 0),
      reviewRequired: true,
      reviewReason: "Wall hints are rough — will be refined by local detector.",
    }));

    return new Response(JSON.stringify({ unitTypeName: finalUnitTypeName, vtops }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("extract-pdf-vtops error:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : "Unknown error" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
