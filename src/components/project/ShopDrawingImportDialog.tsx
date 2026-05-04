import { useState, useRef, useCallback, useEffect } from 'react';
import { FileUp, X, Loader2, CheckCircle, AlertCircle, Sparkles, Trash2, FilePlus, FileText } from 'lucide-react';
import type { CabinetType, Room } from '@/types/project';
import { extractPlanSkuCountsFromTextItems, mergePrefinalExtractionPasses } from '@/lib/prefinalCabinetMerge';
import { toast } from 'sonner';
import { startExtraction, useExtractionJobByType, clearExtractionJob } from '@/hooks/useExtractionStore';

const EDGE_FUNCTION_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/extract-pdf-labels`;

const QUOTES = [
  "Measure twice, cut once.",
  "Great design is born from great planning.",
  "Every detail matters — especially in kitchens.",
  "Precision today saves rework tomorrow.",
  "Good plans shape good results.",
  "The best spaces begin on paper.",
  "Form follows function — always.",
  "Craftsmanship starts with accurate takeoffs.",
  "A well-planned kitchen is a joy forever.",
  "Excellence is in the details.",
  "Build smart. Build right. Build once.",
  "Your project, perfectly counted.",
  "Behind every great build is a great plan.",
  "Think ahead. Cut once. Install right.",
  "The blueprint is where dreams become structure.",
];

export interface LabelRow {
  sku: string;
  type: string;          // Base | Wall | Tall | Vanity | Accessory
  room: string;
  quantity: number;
  selected: boolean;
  sourceFile?: string;
  detectedUnitType?: string;  // AI-detected unit type from the PDF
}

interface Props {
  unitType?: string;
  onImport: (rows: Omit<LabelRow, 'selected' | 'sourceFile'>[], detectedUnitType?: string, typeOrder?: string[]) => void;
  onClose: () => void;
  prefinalPerson?: string;
  speedMode?: 'fast' | 'thorough';
  skipClassify?: boolean;
  aiModel?: 'fast' | 'accu';
  aiProvider?: 'gemini' | 'dialagram';
  dialagramModel?: string;
}

const PERSONAL_QUOTES = [
  (name: string) => `${name}, you've got this — one unit at a time! 💪`,
  (name: string) => `Keep going, ${name}! Accuracy is your superpower.`,
  (name: string) => `${name}, precision like yours builds perfection.`,
  (name: string) => `You're crushing it, ${name}! Every count matters.`,
  (name: string) => `${name}, great takeoffs start with great people like you.`,
  (name: string) => `Stay sharp, ${name} — excellence is in the details!`,
  (name: string) => `${name}, believe in the process. You're almost there!`,
  (name: string) => `One page closer, ${name}. You make it look easy! ✨`,
  (name: string) => `${name}, your dedication to accuracy is inspiring.`,
  (name: string) => `Trust the grind, ${name}. The results will speak!`,
  (name: string) => `${name}, legends aren't born — they count cabinets. 😄`,
  (name: string) => `Focus and flow, ${name}. You're in the zone!`,
];

type Step = 'upload' | 'processing' | 'review';

const CABINET_TYPES: CabinetType[] = ['Base', 'Wall', 'Tall', 'Vanity'];
const ROOMS: Room[] = ['Kitchen', 'Pantry', 'Laundry', 'Bath', 'Other'];
const ALL_TYPES = [...CABINET_TYPES, 'Accessory'];

async function renderPageToBase64(page: any): Promise<string> {
  const { canvas } = await renderPageToCanvasData(page);
  return canvasToBase64Full(canvas);
}

async function renderPageToCanvasData(page: any): Promise<{ canvas: OffscreenCanvas | HTMLCanvasElement; width: number; height: number }> {
  const MAX_PX = 3200;
  const baseViewport = page.getViewport({ scale: 1 });
  const longSide = Math.max(baseViewport.width, baseViewport.height);
  const scale = Math.min(4, MAX_PX / longSide);
  const viewport = page.getViewport({ scale });
  const w = Math.ceil(viewport.width);
  const h = Math.ceil(viewport.height);

  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(w, h);
    const ctx = canvas.getContext('2d')!;
    await page.render({ canvasContext: ctx, viewport }).promise;
    return { canvas, width: w, height: h };
  }

  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  await page.render({ canvasContext: ctx, viewport }).promise;
  return { canvas, width: w, height: h };
}

async function canvasToBase64Full(canvas: OffscreenCanvas | HTMLCanvasElement): Promise<string> {
  if (canvas instanceof OffscreenCanvas) {
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.7 });
    const buf = await blob.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }
  return (canvas as HTMLCanvasElement).toDataURL('image/jpeg', 0.95).split(',')[1];
}

async function canvasCropToBase64(
  sourceCanvas: OffscreenCanvas | HTMLCanvasElement,
  sx: number, sy: number, sw: number, sh: number
): Promise<string> {
  if (typeof OffscreenCanvas !== 'undefined') {
    const crop = new OffscreenCanvas(sw, sh);
    const ctx = crop.getContext('2d')!;
    ctx.drawImage(sourceCanvas as any, sx, sy, sw, sh, 0, 0, sw, sh);
    const blob = await crop.convertToBlob({ type: 'image/jpeg', quality: 0.7 });
    const buf = await blob.arrayBuffer();
    const bytes = new Uint8Array(buf);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }
  const crop = document.createElement('canvas');
  crop.width = sw;
  crop.height = sh;
  const ctx = crop.getContext('2d')!;
  ctx.drawImage(sourceCanvas as HTMLCanvasElement, sx, sy, sw, sh, 0, 0, sw, sh);
  return crop.toDataURL('image/jpeg', 0.92).split(',')[1];
}

async function renderPageStrips(
  canvas: OffscreenCanvas | HTMLCanvasElement,
  w: number, h: number
): Promise<string[]> {
  // 2 cols × 3 rows with ~30% overlap for comprehensive coverage
  const colRanges: [number, number][] = [[0, 0.65], [0.35, 1.0]];
  const rowRanges: [number, number][] = [[0, 0.47], [0.27, 0.73], [0.53, 1.0]];
  const strips: string[] = [];
  for (const [ry, rye] of rowRanges) {
    for (const [rx, rxe] of colRanges) {
      const sx = Math.floor(rx * w);
      const sy = Math.floor(ry * h);
      const sw = Math.ceil((rxe - rx) * w);
      const sh = Math.ceil((rye - ry) * h);
      strips.push(await canvasCropToBase64(canvas, sx, sy, sw, sh));
    }
  }
  return strips;
}

function normalizeTypeKey(value: string): string {
  return String(value || '')
    .toUpperCase()
    .trim()
    .replace(/^TYPE\s+/, '')
    .replace(/[^A-Z0-9.]/g, '');
}

function normalizeTypeText(value: string): string {
  return String(value || '')
    .toUpperCase()
    .trim()
    .replace(/[\u2010-\u2015]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/\s*-\s*/g, '-')
    .replace(/\s*\(\s*/g, ' (')
    .replace(/\s*\)\s*/g, ')')
    .trim();
}

function normalizeTypeBase(value: string): string {
  const text = normalizeTypeText(value);
  if (!text) return '';
  if (/\bKITCHENETTE\b/.test(text)) return 'KITCHENETTE';

  const canonical = text.replace(/\s+\((AS|MIRROR|ADA|REV|ALT|OPTION)\)$/i, '-$1');
  // Strip trailing variant suffixes (-AS, -MIRROR, etc.) but preserve underscore compound parts
  const patterns = [
    /^((?:STUDIO|\d+BR)-[A-Z0-9._]+(?:[_][A-Z][A-Z0-9._-]*)*)(?:-(?:AS|MIRROR|ADA|REV|ALT|OPTION))?$/,
    /^((?:STUDIO|\d+BR)\s+TYPE\s+[A-Z0-9._]+(?:[_][A-Z][A-Z0-9._-]*)*)(?:-(?:AS|MIRROR|ADA|REV|ALT|OPTION))?$/,
    /^(TYPE\s+(?:STUDIO|\d+BR)-[A-Z0-9._]+(?:[_][A-Z][A-Z0-9._-]*)*)(?:-(?:AS|MIRROR|ADA|REV|ALT|OPTION))?$/,
    /^(TYPE\s+[A-Z0-9._]+(?:[_][A-Z][A-Z0-9._-]*)*)(?:-(?:AS|MIRROR|ADA|REV|ALT|OPTION))?$/,
  ];

  for (const pattern of patterns) {
    const match = canonical.match(pattern);
    if (match) return match[1];
  }

  return canonical;
}

function normalizeTypeComparison(value: string): string {
  return normalizeTypeText(value);
}

function isCommonAreaType(value: string): boolean {
  return COMMON_AREA_LABELS.some((entry) => entry.re.test(String(value || '')));
}

const COMMON_AREA_LABELS: Array<{ label: string; re: RegExp }> = [
  { label: 'Kitchenette', re: /\bKITCHENETTE\b/i },
  { label: 'Toilet', re: /\bTOILET\b/i },
  { label: 'Library', re: /\bLIBRARY\b/i },
  { label: 'Saloon', re: /\bSALOON\b/i },
  { label: 'Salon', re: /\bSALON\b/i },
  { label: 'Hair Salon', re: /\bHAIR\s*SALON\b/i },
  { label: 'Lounge', re: /\bLOUNGE\b/i },
  { label: 'Game Room', re: /\bGAME\s*ROOM\b/i },
  { label: 'Theater', re: /\bTHEAT(?:RE|ER)\b/i },
  { label: 'Media Room', re: /\bMEDIA\s*ROOM\b/i },
  { label: 'Card Room', re: /\bCARD\s*ROOM\b/i },
  { label: 'Craft Room', re: /\bCRAFT\s*ROOM\b/i },
  { label: 'Activity Room', re: /\bACTIVITY\s*ROOM\b/i },
  { label: 'Conference Room', re: /\bCONFERENCE\s*ROOM\b/i },
  { label: 'Dining Room', re: /\bDINING\s*(?:ROOM|HALL)\b/i },
  { label: 'Coffee Bar', re: /\bCOFFEE\s*BAR\b/i },
  { label: 'Cafe', re: /\bCAFE\b/i },
  { label: 'Bar', re: /\bBAR\b/i },
  { label: 'Pub', re: /\bPUB\b/i },
  { label: 'Wellness', re: /\bWELLNESS\b/i },
  { label: 'Spa', re: /\bSPA\b/i },
  { label: 'Yoga', re: /\bYOGA\b/i },
  { label: 'Multi-Purpose Room', re: /\bMULTI[-\s]?PURPOSE\b/i },
  { label: 'Computer Room', re: /\bCOMPUTER\s*ROOM\b/i },
  { label: 'Hobby Room', re: /\bHOBBY\s*ROOM\b/i },
  { label: 'Music Room', re: /\bMUSIC\s*ROOM\b/i },
  { label: 'Mail Room', re: /\bMAIL\s*ROOM\b/i },
  { label: 'Break Room', re: /\bBREAK\s*ROOM\b/i },
  { label: 'Business Center', re: /\bBUSINESS\s*CENTER\b/i },
  { label: 'Community Room', re: /\bCOMMUNITY\s*ROOM\b/i },
  { label: 'Pool Bath', re: /\bPOOL\s*BATH\b/i },
  { label: 'Leasing', re: /\bLEASING\b/i },
  { label: 'Clubhouse', re: /\bCLUBHOUSE\b/i },
  { label: 'Fitness', re: /\bFITNESS\b/i },
  { label: 'Laundry', re: /\bLAUNDRY\b/i },
  { label: 'Restroom', re: /\bRESTROOM\b/i },
  { label: 'Lobby', re: /\bLOBBY\b/i },
  { label: 'Office', re: /\bOFFICE\b/i },
  { label: 'Reception', re: /\bRECEPTION\b/i },
  { label: 'Storage', re: /\bSTORAGE\b/i },
  { label: 'Garage', re: /\bGARAGE\b/i },
  { label: 'Corridor', re: /\bCORRIDOR\b/i },
  { label: 'Mechanical', re: /\bMECHANICAL\b/i },
  { label: 'Maintenance', re: /\bMAINTENANCE\b/i },
  { label: 'Trash', re: /\bTRASH\b/i },
];

function extractCommonAreaLabel(pageText: string): string | null {
  const text = String(pageText || '');
  for (const entry of COMMON_AREA_LABELS) {
    if (entry.re.test(text)) return entry.label;
  }
  return null;
}

function extractUploadedTypeLabelFromText(pageText: string): string | null {
  const text = normalizeTypeText(pageText);
  if (!text) return null;

  const candidates: string[] = [];
  const beforeUnitRe = /\b([A-Z][A-Z0-9&/ ]{1,70}?)(?:\s*[-–—]\s*(AS|MIRROR|ADA|REV|ALT|OPTION))?\s+UNIT\s*#?\s*\d+\b/g;
  let match: RegExpExecArray | null;

  while ((match = beforeUnitRe.exec(text)) !== null) {
    const rawWords = match[1]
      .split(/\s+/)
      .map((word) => word.trim())
      .filter(Boolean)
      .filter((word) => !/^(PROJECT|SENIOR|HOUSING|APARTMENT|APARTMENTS|BUILDING|BLDG|FLOOR|LEVEL|PHASE|THE|OF|AT)$/i.test(word));
    const tail = rawWords.slice(-2).join(' ').trim();
    if (!tail || /^(UNIT|TYPE|ELEVATION|SHEET|PLAN|DRAWING)$/i.test(tail)) continue;
    candidates.push(`${tail}${match[2] ? `-${match[2].toUpperCase()}` : ''}`);
  }

  return chooseMostSpecificType(candidates);
}

function extractTypeHintsFromText(pageText: string): string[] {
  const text = normalizeTypeText(pageText);

  if (!text) return [];

  const out: string[] = [];
  const seen = new Set<string>();
  const push = (label: string) => {
    const clean = normalizeTypeText(label);
    if (!clean) return;
    if (/\b(TYPE\s+PLAN|ELEVATION|SECTION|DETAIL|SHEET|DRAWING|LEGEND)\b/i.test(clean)) return;
    // Reject "UNIT # N" patterns — these are unit numbers, not type names
    if (/^\s*UNIT\s*#?\s*\d+\s*$/i.test(clean)) return;
    const key = normalizeTypeKey(clean);
    if (!key || seen.has(key)) return;
    seen.add(key);
    out.push(clean);
  };

  // Helper to prepend bedroom prefix if present before TYPE
  const findBedroomPrefix = (fullText: string, matchIndex: number): string => {
    // Look backwards from the match for a bedroom prefix like "1BR", "2BR", "3BR", "STUDIO"
    const before = fullText.substring(Math.max(0, matchIndex - 20), matchIndex).trim();
    const brMatch = before.match(/\b(\d+\s*BR|STUDIO)\s*$/i);
    return brMatch ? brMatch[1].replace(/\s+/g, '') + ' ' : '';
  };

  const typeBase = '([A-Z0-9._]+(?:\\s*[-_]\\s*(?!AS\\b|MIRROR\\b|ADA\\b|REV\\b|ALT\\b|OPTION\\b)[A-Z0-9._]+)*)';
  const variantToken = '(AS|MIRROR|ADA|REV|ALT|OPTION)';
  const combined = new RegExp(`\\bTYPE\\s+${typeBase}\\s*(?:-|:)?\\s*${variantToken}\\s*(?:\\/|&|AND)\\s*${variantToken}\\b`, 'g');
  let match: RegExpExecArray | null;
  while ((match = combined.exec(text)) !== null) {
    const prefix = findBedroomPrefix(text, match.index);
    const base = match[1];
    const left = match[2];
    const right = match[3];
    push(`${prefix}TYPE ${base}-${left}`);
    push(`${prefix}TYPE ${base}-${right}`);
  }

  const single = new RegExp(`\\bTYPE\\s+${typeBase}\\s*(?:-|:)?\\s*${variantToken}\\b`, 'g');
  while ((match = single.exec(text)) !== null) {
    const prefix = findBedroomPrefix(text, match.index);
    const base = match[1];
    const variant = match[2];
    push(`${prefix}TYPE ${base}-${variant}`);
  }

  // Also match full pattern with parenthesized variants like "1BR TYPE A (ADA)"
  const withParen = /\b(?:(\d+\s*BR|STUDIO)\s+)?TYPE\s+([A-Z0-9.]+(?:\s*-\s*[A-Z0-9.]+)*)\s*\(([A-Z0-9.]+)\)/g;
  while ((match = withParen.exec(text)) !== null) {
    const brPrefix = match[1] ? match[1].replace(/\s+/g, '') + ' ' : findBedroomPrefix(text, match.index);
    push(`${brPrefix}TYPE ${match[2]} (${match[3]})`);
  }

  // Match slash-separated type pairs like "TYPE A / TYPE A-AS" or "1BR-A / 1BR-A-MIRROR"
  const slashPair = /\b(?:(\d+\s*BR|STUDIO)\s+)?TYPE\s+([A-Z0-9.]+(?:\s*-\s*[A-Z0-9.]+)*)\s*\/\s*(?:TYPE\s+)?([A-Z0-9.]+(?:\s*-\s*[A-Z0-9.]+)*)\b/g;
  while ((match = slashPair.exec(text)) !== null) {
    const brPrefix = match[1] ? match[1].replace(/\s+/g, '') + ' ' : findBedroomPrefix(text, match.index);
    push(`${brPrefix}TYPE ${match[2]}`);
    push(`${brPrefix}TYPE ${match[3]}`);
  }

  const generic = new RegExp(`\\bTYPE\\s+${typeBase}(?!\\s*(?:-|:)?\\s*(?:AS|MIRROR|ADA|REV|ALT|OPTION)\\b)(?!\\s*\\()`, 'g');
  while ((match = generic.exec(text)) !== null) {
    const prefix = findBedroomPrefix(text, match.index);
    push(`${prefix}TYPE ${match[1]}`);
  }

  // Match standalone bedroom-type patterns like "2BR-3-AS", but require the code part
  // to contain at least one letter to avoid matching partial fragments like "2BR-2" from "2BR-2-AS"
  const standaloneBedroomType = /\b(STUDIO|\d+\s*BR)\s*-\s*([A-Z][A-Z0-9._]*(?:[_][A-Z][A-Z0-9._-]*)*)(?:\s*-\s*(ADA|AS|MIRROR|REV|ALT|OPTION))?\b/g;
  while ((match = standaloneBedroomType.exec(text)) !== null) {
    const bedroom = match[1].replace(/\s+/g, '');
    const code = match[2];
    const variant = match[3] ? `-${match[3]}` : '';
    push(`${bedroom}-${code}${variant}`);
  }
  // Also match numeric-only codes like "0BR-1" but only if they appear as complete standalone types
  // (not as prefixes of longer types like "0BR-1 ADA" which is handled above)
  const numericBedroomType = /\b(STUDIO|\d+\s*BR)\s*-\s*(\d+)(?:\s*-\s*(ADA|AS|MIRROR|REV|ALT|OPTION))?\b(?!\s*-\s*[A-Z])/g;
  while ((match = numericBedroomType.exec(text)) !== null) {
    const bedroom = match[1].replace(/\s+/g, '');
    const code = match[2];
    const variant = match[3] ? `-${match[3]}` : '';
    push(`${bedroom}-${code}${variant}`);
  }

  // Match standalone slash-separated bedroom-types like "1BR-A / 1BR-A-AS"
  const slashBedroomPair = /\b(\d+\s*BR|STUDIO)\s*-\s*([A-Z][A-Z0-9._]*(?:[_][A-Z][A-Z0-9._-]*)*)\s*\/\s*(?:\d+\s*BR|STUDIO)\s*-\s*([A-Z][A-Z0-9._]*(?:[_][A-Z][A-Z0-9._-]*)*(?:\s*-\s*(?:AS|MIRROR|ADA|REV|ALT|OPTION))?)\b/g;
  while ((match = slashBedroomPair.exec(text)) !== null) {
    const bedroom = match[1].replace(/\s+/g, '');
    push(`${bedroom}-${match[2]}`);
    push(`${bedroom}-${match[3].replace(/\s*-\s*/g, '-')}`);
  }

  if (/\bKITCHENETTE\b/.test(text)) {
    push('KITCHENETTE');
  }

  return out;
}

// Preserve full type name including bedroom prefixes (no longer stripped)
function stripBedroomPrefix(value: string): string {
  return String(value || '').trim();
}

function typeSpecificityScore(value: string): number {
  const normalized = normalizeTypeComparison(value);
  if (!normalized) return -1;

  let score = normalized.length;
  if (/\b(ADA|AS|MIRROR|REV|ALT|OPTION)\b/.test(normalized)) score += 40;
  if (/\(/.test(normalized)) score += 20;
  if (/\bKITCHENETTE\b/.test(normalized)) score += 20;
  if (/\b(STUDIO|\d+BR)\b/.test(normalized)) score += 10;
  return score;
}

function chooseMostSpecificType(candidates: string[]): string | null {
  const unique = Array.from(new Set(candidates.map((candidate) => String(candidate || '').trim()).filter(Boolean)));
  if (unique.length === 0) return null;

  return unique.sort((a, b) => {
    const scoreDiff = typeSpecificityScore(b) - typeSpecificityScore(a);
    if (scoreDiff !== 0) return scoreDiff;
    return normalizeTypeComparison(b).length - normalizeTypeComparison(a).length;
  })[0];
}

function resolvePageUnitType(
  aiType: unknown,
  pageText: string,
  isCommonAreaPage = false,
): { primary: string | null; aliases: string[] } {
  let ai = stripBedroomPrefix(String(aiType ?? '').trim());
  // Filter out "UNIT # N" patterns — these are unit numbers, not type names
  if (/^\s*UNIT\s*#?\s*\d+\s*$/i.test(ai)) ai = '';
  const textHints = extractTypeHintsFromText(pageText);

  if (isCommonAreaPage) {
    const baseLabel = extractCommonAreaLabel(isCommonAreaType(ai) ? ai : (pageText || ''));
    if (!baseLabel) {
      const uploadedTypeLabel = extractUploadedTypeLabelFromText(ai || pageText);
      return uploadedTypeLabel ? { primary: uploadedTypeLabel, aliases: [uploadedTypeLabel] } : { primary: null, aliases: [] };
    }

    // Check for variant suffixes (AS, MIRROR, ADA, etc.) in AI type or page text
    const variantRe = /[-–—\s](AS|MIRROR|ADA|REV|ALT|OPTION)\s*$/i;
    const aiVariant = (ai || '').match(variantRe);
    if (aiVariant) {
      const fullLabel = `${baseLabel}-${aiVariant[1].toUpperCase()}`;
      return { primary: fullLabel, aliases: [fullLabel] };
    }

    // Check page text for variant near the common area name
    const escapedBase = baseLabel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const textVariantRe = new RegExp(`\\b${escapedBase}\\s*[-–—]\\s*(AS|MIRROR|ADA|REV|ALT|OPTION)\\b`, 'i');
    const textVariant = (pageText || '').match(textVariantRe);
    if (textVariant) {
      const fullLabel = `${baseLabel}-${textVariant[1].toUpperCase()}`;
      return { primary: fullLabel, aliases: [fullLabel] };
    }

    return { primary: baseLabel, aliases: [baseLabel] };
  }

  if (!ai && textHints.length === 0) return { primary: null, aliases: [] };

  if (ai) {
    if (isCommonAreaType(ai)) {
      return { primary: ai, aliases: [ai] };
    }

    const aiKey = normalizeTypeKey(ai);
    const aiBase = normalizeTypeBase(ai);
    const exactTextMatch = textHints.find((hint) => normalizeTypeKey(hint) === aiKey);
    const sameBaseMatches = aiBase
      ? textHints.filter((hint) => normalizeTypeBase(hint) === aiBase)
      : [];

    if (exactTextMatch) {
      const best = chooseMostSpecificType([ai, exactTextMatch, ...sameBaseMatches]) ?? exactTextMatch;
      // Only include variants that share the same base as aliases (e.g., TYPE A-AS and TYPE A-MIRROR)
      const validAliases = sameBaseMatches.length > 0
        ? Array.from(new Set([best, ...sameBaseMatches]))
        : [best];
      return { primary: best, aliases: validAliases };
    }

    if (sameBaseMatches.length > 0) {
      const best = chooseMostSpecificType([ai, ...sameBaseMatches]) ?? ai;
      return { primary: best, aliases: Array.from(new Set([best, ...sameBaseMatches])) };
    }

    // No text hint matches the AI type — trust the AI, do NOT add unrelated text hints as aliases
    return { primary: ai, aliases: [ai] };
  }

  // No AI type — use best text hint only (not all of them)
  const best = chooseMostSpecificType(textHints);
  if (best) {
    // Only include hints sharing the same base as aliases
    const bestBase = normalizeTypeBase(best);
    const relatedHints = bestBase
      ? textHints.filter((h) => normalizeTypeBase(h) === bestBase)
      : [best];
    return { primary: best, aliases: Array.from(new Set([best, ...relatedHints])) };
  }

  return { primary: null, aliases: [] };
}

export default function ShopDrawingImportDialog({ unitType, onImport, onClose, prefinalPerson, speedMode = 'fast', skipClassify = false, aiModel = 'fast', aiProvider = 'gemini', dialagramModel = 'qwen-3.6-plus' }: Props) {
  const [step, setStep] = useState<Step>('upload');
  const [rows, setRows] = useState<LabelRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const [processingStatus, setProcessingStatus] = useState('');
  const [queuedFiles, setQueuedFiles] = useState<File[]>([]);
  const [filterSource, setFilterSource] = useState<string>('all');
  const [detectedUnitType, setDetectedUnitType] = useState<string | null>(null);
  const [typeOrder, setTypeOrder] = useState<string[]>([]);
  const [quoteIndex, setQuoteIndex] = useState(() => Math.floor(Math.random() * QUOTES.length));
  const [personalQuoteIndex, setPersonalQuoteIndex] = useState(() => Math.floor(Math.random() * PERSONAL_QUOTES.length));
  const [quoteVisible, setQuoteVisible] = useState(true);
  const [progress, setProgress] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [processedPages, setProcessedPages] = useState(0);
  const [totalSteps, setTotalSteps] = useState(0);
  const stepsCompletedRef = useRef(0);
  const fileRef = useRef<HTMLInputElement>(null);
  const addMoreRef = useRef<HTMLInputElement>(null);

  // ── Pick up background job results ──────────────────────────────────
  const bgJob = useExtractionJobByType('cabinet');
  const bgPickedUpRef = useRef(false);

  useEffect(() => {
    if (!bgJob || bgPickedUpRef.current) return;
    if (bgJob.status === 'processing') {
      // Show processing state from background job
      setStep('processing');
      setProgress(bgJob.progress);
      setProcessedPages(bgJob.processedPages);
      setTotalPages(bgJob.totalPages);
      setProcessingStatus(bgJob.statusText);
    } else if (bgJob.status === 'done') {
      // Auto-load results into review
      bgPickedUpRef.current = true;
      const r = bgJob.results as { rows: any[]; detectedUnitType: string | null; typeOrder: string[] } | null;
      setRows(r?.rows ?? []);
      setDetectedUnitType(r?.detectedUnitType ?? null);
      setTypeOrder(r?.typeOrder ?? []);
      setFilterSource('all');
      setProgress(100);
      setStep('review');
      clearExtractionJob('cabinet');
    } else if (bgJob.status === 'error') {
      bgPickedUpRef.current = true;
      setError(bgJob.error);
      setStep('upload');
      clearExtractionJob('cabinet');
    }
  }, [bgJob]);

  // Sync ongoing background progress into local state
  useEffect(() => {
    if (!bgJob || bgJob.status !== 'processing' || bgPickedUpRef.current) return;
    setProgress(bgJob.progress);
    setProcessedPages(bgJob.processedPages);
    setTotalPages(bgJob.totalPages);
    setProcessingStatus(bgJob.statusText);
  }, [bgJob?.progress, bgJob?.processedPages, bgJob?.statusText]);

  // Rotate quote every 4 seconds during processing
  useEffect(() => {
    if (step !== 'processing') return;
    const interval = setInterval(() => {
      setQuoteVisible(false);
      setTimeout(() => {
        setQuoteIndex(i => (i + 1) % QUOTES.length);
        setPersonalQuoteIndex(i => (i + 1) % PERSONAL_QUOTES.length);
        setQuoteVisible(true);
      }, 400);
    }, 4000);
    return () => clearInterval(interval);
  }, [step]);

  const processSingleFile = async (
    file: File,
    pdfjsLib: any,
    onStatus: (msg: string) => void,
    onPageDone?: () => void,
    onStepDone?: () => void,
  ): Promise<{ rows: LabelRow[]; detectedType: string | null; typeOrder: string[] }> => {
    const arrayBuffer = await file.arrayBuffer();
    const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
    const allRows: LabelRow[] = [];
    let detectedType: string | null = null;
    const pageTypeOrder: string[] = [];

    const pageTasks: { p: number; file: File }[] = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      pageTasks.push({ p, file });
    }

    const processOnePage = async (p: number) => {
      onStatus(`Rendering "${file.name}" page ${p}/${pdf.numPages}…`);
      const page = await pdf.getPage(p);

      // Render to canvas (kept in memory for strip cropping)
      const { canvas, width: canvasW, height: canvasH } = await renderPageToCanvasData(page);
      const pageImage = await canvasToBase64Full(canvas);

      // Extract text layer from the PDF page for cross-referencing
      let pageText = '';
      let planTextSkuCounts: Record<string, number> = {};
      try {
        const textContent = await page.getTextContent();
        const textItems = Array.isArray(textContent.items) ? textContent.items : [];
        pageText = textItems
          .map((item: any) => item.str)
          .filter((s: string) => s.trim().length > 0)
          .join(' ');
        planTextSkuCounts = extractPlanSkuCountsFromTextItems(textItems as Array<{ str?: string; transform?: number[] }>);
      } catch (e) {
        console.warn(`Text extraction failed for page ${p}:`, e);
      }

      onStatus(`AI analyzing "${file.name}" page ${p}/${pdf.numPages}…`);

      // Retry helper: try up to 3 times with a 5-minute timeout each attempt
      const fetchWithRetry = async (body: string, attempts = 3): Promise<Response> => {
        for (let attempt = 1; attempt <= attempts; attempt++) {
          const controller = new AbortController();
          const timeoutId = setTimeout(() => controller.abort(), 5 * 60 * 1000);
          try {
            if (attempt > 1) {
              onStatus(`AI reading "${file.name}" page ${p}/${pdf.numPages} (retry ${attempt - 1})…`);
            }
            const res = await fetch(EDGE_FUNCTION_URL, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body,
              signal: controller.signal,
            });
            clearTimeout(timeoutId);
            if ((res.status === 503 || res.status === 500) && attempt < attempts) {
              console.warn(`Page ${p} attempt ${attempt}: AI unavailable (${res.status}), retrying in ${3 * attempt}s…`);
              await new Promise(r => setTimeout(r, 3000 * attempt));
              continue;
            }
            return res;
          } catch (err: any) {
            clearTimeout(timeoutId);
            if (attempt === attempts) throw err;
            console.warn(`Page ${p} attempt ${attempt} failed (${err.message}), retrying…`);
            await new Promise(r => setTimeout(r, 2000));
          }
        }
        throw new Error('All attempts failed');
      };

      // ── PASS 1: Full page (extract, with optional classification skip) ──
      const fullResponse = await fetchWithRetry(JSON.stringify({ pageImage, unitType, pageText, speedMode, skipClassify, aiModel, aiProvider, dialagramModel }));
      if (!fullResponse.ok) {
        const status = fullResponse.status;
        if (status === 429) throw new Error('rate_limit');
        if (status === 402) throw new Error('credits');
        throw new Error(`failed (${status})`);
      }

      const fullData = await fullResponse.json();
      if (fullData.error === 'rate_limit') throw new Error('rate_limit');
      if (fullData.error === 'credits') throw new Error('credits');
      onStepDone?.(); // Full-page pass complete

      const fullItems = fullData.items ?? [];
      const pageType = String(fullData.pageType || 'plan_view');
      const isCommonArea = fullData.isCommonArea ?? false;
      const resolvedType = resolvePageUnitType(fullData.unitTypeName, pageText, isCommonArea);

      // Skip strips for title pages and non-extraction pages (residential elevations)
      const shouldDoStrips = !pageType.includes('title');
      if (!shouldDoStrips) {
        // Mark remaining 6 strip steps as done
        for (let s = 0; s < 6; s++) onStepDone?.();
        return {
          ...fullData,
          unitTypeName: resolvedType.primary,
          unitTypeAliases: resolvedType.aliases,
        };
      }

      // ── PASSES 2-7: 6 overlapping strips for detail recovery (3 at a time) ──
      onStatus(`Detail scanning "${file.name}" page ${p}/${pdf.numPages}…`);
      const strips = await renderPageStrips(canvas, canvasW, canvasH);
      const allPassItems = [fullItems];

      const classificationOverride = {
        pageType,
        unitTypeName: resolvedType.primary,
        isCommonArea,
      };

      // Send all 6 strips in parallel for speed
      onStatus(`Detail scan 1-${strips.length}/${strips.length} on "${file.name}" page ${p}/${pdf.numPages}…`);

      const allStripResults = await Promise.allSettled(
        strips.map(async (stripImage, idx) => {
          const stripResponse = await fetchWithRetry(JSON.stringify({
            pageImage: stripImage,
            unitType,
            pageText,
            speedMode,
            classificationOverride,
            isStrip: true,
            aiModel,
            aiProvider,
            dialagramModel,
          }));
          if (stripResponse.ok) {
            const stripData = await stripResponse.json();
            if (stripData.error) {
              console.warn(`Strip ${idx + 1} error:`, stripData.error);
              return null;
            }
            if (stripData.items?.length > 0) {
              console.log(`Page ${p} strip ${idx + 1}: found ${stripData.items.length} items`);
              return stripData.items;
            }
          }
          return null;
        })
      );

      for (const result of allStripResults) {
        if (result.status === 'fulfilled' && result.value) {
          allPassItems.push(result.value);
        } else if (result.status === 'rejected') {
          const err = result.reason;
          if (err?.message === 'rate_limit') throw err;
          if (err?.message === 'credits') throw err;
          console.warn(`Strip failed:`, err?.message);
        }
        onStepDone?.();
      }

      // ── Merge all passes: MAX qty per SKU+room ──
      const merged = mergePrefinalExtractionPasses(allPassItems, planTextSkuCounts);
      console.log(`Page ${p}: ${fullItems.length} full-page + strips → ${merged.length} merged items`);

      return {
        items: merged,
        unitTypeName: resolvedType.primary,
        unitTypeAliases: resolvedType.aliases,
        isCommonArea,
      };
    };

    const MAX_PAGE_RETRIES = 3;
    for (const task of pageTasks) {
      let pageResult: any = null;
      let lastError: any = null;

      for (let attempt = 1; attempt <= MAX_PAGE_RETRIES; attempt++) {
        try {
          pageResult = await processOnePage(task.p);
          break;
        } catch (err: any) {
          if (err?.message === 'rate_limit') throw err;
          if (err?.message === 'credits') throw err;
          lastError = err;
          console.warn(`Page ${task.p} attempt ${attempt}/${MAX_PAGE_RETRIES} failed: ${err?.message}`);
          if (attempt < MAX_PAGE_RETRIES) {
            onStatus(`Retrying page ${task.p} of "${file.name}" (attempt ${attempt + 1})…`);
            await new Promise(r => setTimeout(r, 3000 * attempt));
          }
        }
      }

      if (pageResult) {
        const data = pageResult;
        const resolvedPageType = String(data.unitTypeName || '').trim();
        const resolvedTypeAliases = Array.isArray((data as any).unitTypeAliases)
          ? (data as any).unitTypeAliases.map((value: unknown) => normalizeTypeText(String(value || ''))).filter(Boolean)
          : [];
        const pageItems = Array.isArray(data.items) ? data.items : [];
        const hasCabinetRows = pageItems.length > 0;
        const isCommonAreaPage = Boolean((data as any).isCommonArea);
      const fallbackUploadedType = hasCabinetRows && !resolvedPageType
        ? extractUploadedTypeLabelFromText(pageText)
        : null;
      const effectiveResolvedPageType = resolvedPageType || fallbackUploadedType || '';
      const effectiveResolvedAliases = resolvedTypeAliases.length > 0
        ? resolvedTypeAliases
        : (fallbackUploadedType ? [fallbackUploadedType] : []);

        const shouldTrackType = Boolean(effectiveResolvedPageType) || effectiveResolvedAliases.length > 0 || isCommonAreaPage || hasCabinetRows;
        const typesForOrder = effectiveResolvedAliases.length > 0
          ? effectiveResolvedAliases
          : effectiveResolvedPageType
            ? [effectiveResolvedPageType]
            : [];

        // ── STRICT PAGE ORDER ──
        // Push this page's primary type FIRST (before any aliases) so order is stable per page.
        // If only aliases exist (no resolvedPageType), keep their natural order.
        const orderedTypesThisPage = effectiveResolvedPageType
          ? [effectiveResolvedPageType, ...effectiveResolvedAliases.filter(a => a !== effectiveResolvedPageType)]
          : typesForOrder;

        for (const t of orderedTypesThisPage) {
          if (!detectedType) detectedType = t;
          if (!pageTypeOrder.includes(t)) pageTypeOrder.push(t);
        }

        const pageRows = pageItems.map((c: any) => ({
          sku: c.sku,
          type: c.type,
          room: c.room,
          quantity: c.quantity,
          selected: true,
          sourceFile: file.name,
          detectedUnitType: shouldTrackType ? (effectiveResolvedPageType || undefined) : undefined,
        }));
        allRows.push(...pageRows);
      } else {
        console.warn(`Page ${task.p} of "${file.name}" failed after ${MAX_PAGE_RETRIES} attempts:`, lastError?.message);
      }
      onPageDone?.();
    }
    return { rows: allRows, detectedType, typeOrder: pageTypeOrder };
  };

  const mergeRows = (incoming: LabelRow[], existing: LabelRow[] = []): LabelRow[] => {
    // For items within the SAME unit type: use MAX qty across pages (same cabinet seen on multiple pages).
    // For items across DIFFERENT unit types: keep separate (different unit types = different physical units).
    const merged: Record<string, LabelRow> = {};

    for (const r of [...existing, ...incoming]) {
      const normSku = r.sku
        .toUpperCase()
        .trim()
        .replace(/\s*-\s*/g, '-')
        .replace(/\s+/g, '')
        .replace(/B?-\d+D$/i, ''); // Strip door-config suffix (e.g. -1D, B-1D)
      // Include detectedUnitType in key so quantities stay separated per type
      const unitTypeKey = (r as any).detectedUnitType || '__none__';
      const key = `${normSku}__${r.room}__${unitTypeKey}`;
      if (merged[key]) {
        // Use MAX instead of SUM — multiple pages of the same unit type show the SAME cabinets
        merged[key].quantity = Math.max(merged[key].quantity, r.quantity);
      } else {
        merged[key] = { ...r, sku: normSku };
      }
    }
    // Extract wall cabinet height from SKU like W3024 → height 24, W1542 → height 42
    const wallHeight = (sku: string): number => {
      const m = sku.match(/^W\D*(\d{3,5})/i);
      if (!m) return 999;
      const digits = m[1]; // e.g. "3024" or "1542"
      if (digits.length >= 4) return parseInt(digits.slice(-2), 10); // last 2 digits = height
      return 999;
    };

    return Object.values(merged).sort((a, b) => {
      const sortPriority = (r: LabelRow): number => {
        const room = r.room?.toLowerCase() ?? '';
        const type = r.type?.toLowerCase() ?? '';
        const isKitchen = room === 'kitchen';
        const isBath = room === 'bath';
        const isAccessory = type === 'accessory';
        if (isKitchen && type === 'wall') return 0;
        if (isKitchen && type === 'base') return 1;
        if (isKitchen && type === 'tall') return 2;
        if (isKitchen && isAccessory) return 3;
        if (isKitchen) return 4;
        if (isBath && !isAccessory) return 5;
        if (isBath && isAccessory) return 6;
        return 7;
      };
      const pa = sortPriority(a);
      const pb = sortPriority(b);
      if (pa !== pb) return pa - pb;
      // Within wall cabinets, sort by height (smaller first)
      if (a.type?.toLowerCase() === 'wall' && b.type?.toLowerCase() === 'wall') {
        const ha = wallHeight(a.sku);
        const hb = wallHeight(b.sku);
        if (ha !== hb) return ha - hb;
      }
      return a.sku.localeCompare(b.sku, undefined, { numeric: true });
    });
  };

  const doProcessFiles = async (files: File[]) => {
    const nonPdfs = files.filter(f => !f.type.includes('pdf'));
    if (nonPdfs.length) { setError(`Only PDF files supported. Remove: ${nonPdfs.map(f => f.name).join(', ')}`); return; }
    setError(null);
    setStep('processing');
    setProgress(5);
    setProcessedPages(0);
    stepsCompletedRef.current = 0;
    bgPickedUpRef.current = false;

    // Kick off background extraction — processing continues even if dialog closes
    startExtraction('cabinet', files.map(f => f.name), async (update) => {
      try {
        update({ statusText: 'Loading PDF library…' });
        const pdfjsLib = (await import('pdfjs-dist')) as any;
        pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();

        let totalPagesCount = 0;
        for (const file of files) {
          const ab = await file.arrayBuffer();
          const pdf = await pdfjsLib.getDocument({ data: new Uint8Array(ab) }).promise;
          totalPagesCount += pdf.numPages;
        }
        const totalStepsCount = totalPagesCount * 7;
        let stepsCompleted = 0;
        let pagesProcessed = 0;

        update({ totalPages: totalPagesCount, progress: 10 });

        let allRows: any[] = [];
        let firstDetectedType: string | null = null;
        const collectedTypeOrder: string[] = [];

        for (let i = 0; i < files.length; i++) {
          update({ statusText: `Processing file ${i + 1} of ${files.length}: "${files[i].name}"…` });
          try {
            const result = await processSingleFile(
              files[i],
              pdfjsLib,
              (msg) => update({ statusText: msg }),
              () => {
                pagesProcessed++;
                update({ processedPages: pagesProcessed });
              },
              () => {
                stepsCompleted++;
                update({ progress: 10 + Math.round((stepsCompleted / totalStepsCount) * 85) });
              },
            );
            // merge rows
            const merged: Record<string, any> = {};
            for (const r of [...allRows, ...result.rows]) {
              const normSku = r.sku.toUpperCase().trim().replace(/\s*-\s*/g, '-').replace(/\s+/g, '').replace(/B?-\d+D$/i, '');
              const unitTypeKey = r.detectedUnitType || '__none__';
              const key = `${normSku}__${r.room}__${unitTypeKey}`;
              if (merged[key]) {
                merged[key].quantity = Math.max(merged[key].quantity, r.quantity);
              } else {
                merged[key] = { ...r, sku: normSku };
              }
            }
            allRows = Object.values(merged);
            if (!firstDetectedType && result.detectedType) firstDetectedType = result.detectedType;
            for (const t of result.typeOrder) {
              if (!collectedTypeOrder.includes(t)) collectedTypeOrder.push(t);
            }
          } catch (err: any) {
            if (err.message === 'rate_limit') {
              update({ status: 'error', error: 'AI rate limit reached. Try again shortly.' });
              return;
            }
            if (err.message === 'credits') {
              update({ status: 'error', error: 'AI credits exhausted.' });
              return;
            }
            console.warn(`Skipped "${files[i].name}": ${err.message}`);
          }
        }

        if (allRows.length === 0 && collectedTypeOrder.length === 0) {
          update({ status: 'error', error: 'No cabinet labels or unit type names found in any uploaded file.' });
          return;
        }

        update({
          status: 'done',
          progress: 100,
          results: { rows: allRows, detectedUnitType: firstDetectedType, typeOrder: collectedTypeOrder },
        });
      } catch (err: any) {
        console.error('Background extraction error:', err);
        update({ status: 'error', error: 'Failed to process files. Please try again.' });
      }
    });
  };

  // Wrap in a Web Lock so the browser won't freeze/discard this tab while processing
  const processFiles = async (files: File[]) => {
    doProcessFiles(files);
  };

  const doAddMoreFiles = async (files: File[]) => {
    setStep('processing');
    try {
      const pdfjsLib = (await import('pdfjs-dist')) as any;
      pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).toString();
      let newRows: LabelRow[] = [];
      const newTypes: string[] = [];
      for (const file of files) {
        setProcessingStatus(`Processing "${file.name}"…`);
        try {
          const result = await processSingleFile(file, pdfjsLib, setProcessingStatus);
          newRows = mergeRows(result.rows, newRows);
          for (const t of result.typeOrder) {
            if (!newTypes.includes(t)) newTypes.push(t);
          }
          if (result.detectedType && !detectedUnitType) setDetectedUnitType(result.detectedType);
        } catch (err: any) { toast.error(`Skipped "${file.name}": ${err.message}`); }
      }
      setRows(prev => mergeRows(newRows, prev));
      if (newTypes.length > 0) {
        setTypeOrder(prev => {
          const merged = [...prev];
          for (const t of newTypes) if (!merged.includes(t)) merged.push(t);
          return merged;
        });
      }
      setStep('review');
    } catch (err) {
      toast.error('Failed to process additional files.');
      setStep('review');
    }
  };

  const addMoreFiles = async (files: File[]) => {
    if (navigator.locks) {
      await navigator.locks.request('shop-drawing-processing', () => doAddMoreFiles(files));
    } else {
      await doAddMoreFiles(files);
    }
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false);
    const files = Array.from(e.dataTransfer.files).filter(f => f.type.includes('pdf'));
    if (files.length) { setQueuedFiles(files); processFiles(files); }
  }, [unitType]);

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    if (files.length) { setQueuedFiles(files); processFiles(files); }
    e.target.value = '';
  };

  const handleAddMore = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []).filter(f => f.type.includes('pdf'));
    if (files.length) addMoreFiles(files);
    e.target.value = '';
  };

  const toggleAll = (val: boolean) => setRows(r => r.map(x => ({ ...x, selected: val })));
  const updateRow = (i: number, patch: Partial<LabelRow>) => setRows(r => r.map((x, j) => j === i ? { ...x, ...patch } : x));
  const deleteRow = (i: number) => setRows(r => r.filter((_, j) => j !== i));

  const handleImport = () => {
    const selected = rows.filter(r => r.selected).map(({ selected: _, sourceFile: __, ...rest }) => rest);
    if (selected.length === 0 && typeOrder.length === 0) return;
    onImport(selected, detectedUnitType ?? undefined, typeOrder.length > 0 ? typeOrder : undefined);
  };

  const sourceFiles = Array.from(new Set(rows.map(r => r.sourceFile ?? 'Unknown')));
  const visibleRows = filterSource === 'all' ? rows : rows.filter(r => r.sourceFile === filterSource);
  const selectedCount = rows.filter(r => r.selected).length;
  const canImport = selectedCount > 0 || typeOrder.length > 0;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.5)' }}>
      <div className="bg-card rounded-xl shadow-2xl w-full max-w-4xl max-h-[90vh] flex flex-col border border-border">

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-border">
          <div className="flex items-center gap-2">
            <FileUp size={18} className="text-primary" />
            <h2 className="font-bold text-base">Import 2020 Shop Drawings</h2>
            {unitType && (
              <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-accent text-accent-foreground border border-border">
                {unitType}
              </span>
            )}
            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-primary/10 text-primary border border-primary/20">
              <Sparkles size={9} /> AI Label Reader
            </span>
          </div>
          <button onClick={onClose} className="text-muted-foreground hover:text-foreground"><X size={18} /></button>
        </div>

        <div className="flex-1 overflow-auto p-5">

          {/* Upload step */}
          {step === 'upload' && (
            <div className="space-y-4">
              <p className="text-sm text-muted-foreground">
                Upload your <strong>2020 Design shop drawing PDFs</strong>. The AI reads each page and extracts cabinet and accessory labels exactly as printed — no measurement or scale required.
              </p>

              <div
                className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
                  dragging ? 'border-primary bg-accent' : 'border-border hover:border-primary hover:bg-accent/50'
                }`}
                onDragOver={e => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)}
                onDrop={handleDrop}
                onClick={() => fileRef.current?.click()}
              >
                <FileUp size={36} className="mx-auto mb-3 text-muted-foreground" />
                <p className="font-semibold text-sm text-foreground">Drop 2020 shop drawing PDFs here</p>
                <p className="text-xs text-muted-foreground mt-1">or click to browse — multiple files supported</p>
                <input ref={fileRef} type="file" accept=".pdf" multiple className="hidden" onChange={handleFileSelect} />
              </div>

              {queuedFiles.length > 0 && (
                <div className="space-y-1">
                  {queuedFiles.map((f, i) => (
                    <div key={i} className="flex items-center gap-2 text-xs text-muted-foreground">
                      <FileText size={12} className="text-primary flex-shrink-0" />
                      <span className="truncate">{f.name}</span>
                      <span className="ml-auto opacity-60">{(f.size / 1024).toFixed(0)} KB</span>
                    </div>
                  ))}
                </div>
              )}

              {error && (
                <div className="flex items-start gap-2 p-3 rounded-lg border text-sm border-destructive bg-destructive/10 text-destructive">
                  <AlertCircle size={16} className="flex-shrink-0 mt-0.5" />
                  <p>{error}</p>
                </div>
              )}

              <div className="text-xs text-muted-foreground bg-secondary rounded-lg p-3 border border-border space-y-1">
                <p className="flex items-center gap-1.5">
                  <Sparkles size={11} className="text-primary flex-shrink-0" />
                  <strong>AI Label Reader:</strong> Each page is rendered as an image and scanned for cabinet (Base, Wall, Tall, Vanity) and accessory labels (fillers, toe kick, crown, panels, hardware). Labels are read exactly as printed — no guessing or measuring.
                </p>
              </div>
            </div>
          )}

          {/* Processing step */}
          {step === 'processing' && (
            <div className="flex flex-col items-center justify-center py-10 gap-6 px-6 animate-fade-in">
              {/* Animated icon cluster */}
              <div className="relative flex items-center justify-center w-20 h-20">
                {/* Pulsing ring */}
                <span className="absolute inset-0 rounded-full opacity-20 animate-[ping_1.8s_cubic-bezier(0,0,0.2,1)_infinite]" style={{ background: 'hsl(var(--primary))' }} />
                <span className="absolute inset-2 rounded-full opacity-10 animate-[ping_1.8s_cubic-bezier(0,0,0.2,1)_0.4s_infinite]" style={{ background: 'hsl(var(--primary))' }} />
                {/* Core circle */}
                <span className="absolute inset-3 rounded-full" style={{ background: 'hsl(var(--primary)/0.12)' }} />
                <Loader2 size={32} className="animate-spin relative z-10" style={{ color: 'hsl(var(--primary))' }} />
                <Sparkles size={13} className="absolute top-2 right-2 z-20 animate-pulse" style={{ color: 'hsl(var(--primary))' }} />
              </div>

              {/* Status + Quote */}
              <div className="text-center space-y-2 max-w-xs">
                <p
                  className="text-xs italic text-muted-foreground/80 transition-opacity duration-400 mt-2 px-2"
                  style={{ opacity: quoteVisible ? 1 : 0, transition: 'opacity 0.4s ease' }}
                >
                  "{QUOTES[quoteIndex]}"
                </p>
                {prefinalPerson && (
                  <p
                    className="text-xs font-medium text-primary transition-opacity duration-400 px-2"
                    style={{ opacity: quoteVisible ? 1 : 0, transition: 'opacity 0.4s ease' }}
                  >
                    {PERSONAL_QUOTES[personalQuoteIndex](prefinalPerson)}
                  </p>
                )}
              </div>

              {/* Progress bar */}
              <div className="w-full max-w-sm space-y-2">
                <div className="flex justify-between items-center text-xs">
                  <span className="text-muted-foreground font-medium">Progress</span>
                  <span className="font-bold tabular-nums" style={{ color: 'hsl(var(--primary))' }}>{progress}%</span>
                </div>
                {/* Track */}
                <div className="relative w-full h-3 rounded-full overflow-hidden" style={{ background: 'hsl(var(--secondary))' }}>
                  {/* Shimmer layer */}
                  <div
                    className="absolute inset-0 -translate-x-full animate-[shimmer_1.6s_ease-in-out_infinite]"
                    style={{
                      background: 'linear-gradient(90deg, transparent 0%, hsl(var(--primary)/0.25) 50%, transparent 100%)',
                      width: '60%',
                    }}
                  />
                  {/* Fill */}
                  <div
                    className="h-full rounded-full transition-all duration-700 ease-out relative overflow-hidden"
                    style={{
                      width: `${progress}%`,
                      background: 'linear-gradient(90deg, hsl(var(--primary)/0.8) 0%, hsl(var(--primary)) 60%, hsl(var(--primary)/0.9) 100%)',
                    }}
                  >
                    {/* Inner shine */}
                    <span className="absolute inset-0 rounded-full" style={{ background: 'linear-gradient(180deg, rgba(255,255,255,0.18) 0%, transparent 60%)' }} />
                  </div>
                </div>

                {/* Step dots */}
                <div className="flex justify-between items-center pt-1">
                  {['Read PDF', 'Extract pages', 'AI analysis', 'Build list'].map((label, idx) => {
                    const stepThreshold = [5, 10, 30, 95][idx];
                    const done = progress >= stepThreshold + 10;
                    const active = progress >= stepThreshold && !done;
                    return (
                      <div key={label} className="flex flex-col items-center gap-1">
                        <div className={`w-2 h-2 rounded-full transition-all duration-500 ${done ? 'scale-110' : active ? 'scale-125 animate-pulse' : 'opacity-30'}`}
                          style={{ background: done || active ? 'hsl(var(--primary))' : 'hsl(var(--muted-foreground))' }}
                        />
                        <span className={`text-[9px] font-medium transition-colors duration-300 ${done || active ? 'text-primary' : 'text-muted-foreground opacity-50'}`}>{label}</span>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* Review step */}
          {step === 'review' && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 p-3 rounded-lg bg-secondary border border-border">
                <CheckCircle size={18} className="text-primary flex-shrink-0" />
                <div className="flex-1 text-sm">
                  <strong className="text-foreground">{rows.length} label{rows.length !== 1 ? 's' : ''} extracted</strong>
                  {sourceFiles.length > 1 && <span className="text-muted-foreground ml-2">from {sourceFiles.length} files</span>}
                  <span className="text-muted-foreground ml-2">— review and edit before importing</span>
                </div>
                <button
                  onClick={() => addMoreRef.current?.click()}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border border-border text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
                >
                  <FilePlus size={13} /> Add more PDFs
                </button>
                <input ref={addMoreRef} type="file" accept=".pdf" multiple className="hidden" onChange={handleAddMore} />
              </div>

              {sourceFiles.length > 1 && (
                <div className="flex flex-wrap gap-1.5">
                  <button onClick={() => setFilterSource('all')} className={`px-3 py-1 rounded-full text-xs font-medium transition-colors ${filterSource === 'all' ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground border border-border hover:text-foreground'}`}>
                    All ({rows.length})
                  </button>
                  {sourceFiles.map(src => (
                    <button key={src} onClick={() => setFilterSource(src)} className={`px-3 py-1 rounded-full text-xs font-medium transition-colors flex items-center gap-1 ${filterSource === src ? 'bg-primary text-primary-foreground' : 'bg-secondary text-muted-foreground border border-border hover:text-foreground'}`}>
                      <FileText size={10} />
                      {src.replace(/\.pdf$/i, '')} ({rows.filter(r => r.sourceFile === src).length})
                    </button>
                  ))}
                </div>
              )}

              <div className="flex items-center gap-3">
                <button onClick={() => toggleAll(true)} className="text-xs text-primary hover:underline">Select all</button>
                <button onClick={() => toggleAll(false)} className="text-xs text-muted-foreground hover:underline">Deselect all</button>
                <span className="text-xs text-muted-foreground ml-auto">{selectedCount} of {rows.length} selected</span>
              </div>

              <div className="border border-border rounded-lg overflow-hidden overflow-x-auto">
                <table className="est-table" style={{ whiteSpace: 'nowrap', minWidth: '560px' }}>
                  <thead>
                    <tr>
                      <th className="w-8"></th>
                      <th>SKU / Label</th>
                      <th>Type</th>
                      <th>Room</th>
                      <th className="text-right">Qty</th>
                      {sourceFiles.length > 1 && <th>File</th>}
                      <th></th>
                    </tr>
                  </thead>
                  <tbody>
                    {visibleRows.map((row, _) => {
                      const globalIdx = rows.indexOf(row);
                      return (
                        <tr key={globalIdx} className={!row.selected ? 'opacity-40' : ''}>
                          <td>
                            <input type="checkbox" checked={row.selected} onChange={e => updateRow(globalIdx, { selected: e.target.checked })} className="cursor-pointer" />
                          </td>
                          <td>
                            <input className="est-input font-mono w-28 text-xs" value={row.sku} onChange={e => updateRow(globalIdx, { sku: e.target.value.toUpperCase() })} />
                          </td>
                          <td>
                            <select className="est-input text-xs w-24" value={row.type} onChange={e => updateRow(globalIdx, { type: e.target.value })}>
                              {ALL_TYPES.map(t => <option key={t}>{t}</option>)}
                            </select>
                          </td>
                          <td>
                            <select className="est-input text-xs w-24" value={row.room} onChange={e => updateRow(globalIdx, { room: e.target.value })}>
                              {ROOMS.map(r => <option key={r}>{r}</option>)}
                            </select>
                          </td>
                          <td>
                            <input type="number" className="est-input text-xs w-14 text-right" value={row.quantity} min={1} onChange={e => updateRow(globalIdx, { quantity: Math.max(1, +e.target.value) })} />
                          </td>
                          {sourceFiles.length > 1 && (
                            <td><span className="text-[10px] text-muted-foreground truncate max-w-[100px] block">{(row.sourceFile ?? '').replace(/\.pdf$/i, '')}</span></td>
                          )}
                          <td>
                            <button onClick={() => deleteRow(globalIdx)} className="p-1 hover:text-destructive text-muted-foreground" title="Remove">
                              <Trash2 size={12} />
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-5 py-4 border-t border-border flex items-center justify-between gap-3">
          <button onClick={() => { setStep('upload'); setRows([]); setQueuedFiles([]); setError(null); }} className="text-xs text-muted-foreground hover:text-foreground">
            ← Start over
          </button>
          <div className="flex items-center gap-2">
            <button onClick={onClose} className="px-4 py-2 rounded text-xs font-medium border border-border text-muted-foreground hover:bg-secondary">
              Cancel
            </button>
            {step === 'review' && (
              <button
                onClick={handleImport}
                disabled={!canImport}
                className="px-4 py-2 rounded text-xs font-medium text-white disabled:opacity-50"
                style={{ background: 'hsl(var(--primary))' }}
              >
                {selectedCount > 0
                  ? `Import ${selectedCount} item${selectedCount !== 1 ? 's' : ''}`
                  : `Import ${typeOrder.length} detected type${typeOrder.length !== 1 ? 's' : ''}`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
