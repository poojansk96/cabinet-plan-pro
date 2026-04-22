// Pure helpers for vanity-top filtering — mirrors the logic in
// supabase/functions/extract-pdf-vtops/index.ts so it can be unit-tested
// from Node/Vitest. Keep the two implementations in sync.

export const VANITY_DEPTH_MIN = 17.5;
export const VANITY_DEPTH_MAX = 22.5;

export type VtopCandidate = {
  length: number;
  depth: number;
  hasSink?: boolean;
  bowlPosition?: 'offset-left' | 'offset-right' | 'center';
  bowlOffset?: number | null;
};

export function hasBathroomContext(text: string): boolean {
  return /\b(vanity|lav(?:atory)?|bath(?:room)?|powder(?:\s*room)?|restroom|wc|unisex\s*bath|half\s*bath)\b/i.test(text);
}

export function hasExcludedCounterContext(text: string): boolean {
  return /\b(kitchen|break\s*room|mail\s*room|community(?:\s*(?:room|building))?|island|pantry|bar\s*top|bartop|corridor|hallway|work\s*station|workstation|lobby|lounge|reception|cafe|coffee|nurse\s*station|laundry|janitor)\b/i.test(text);
}

export function isVanityDepth(depth: number): boolean {
  return Number.isFinite(depth) && depth >= VANITY_DEPTH_MIN && depth <= VANITY_DEPTH_MAX;
}

export function isVanityCandidate(row: VtopCandidate, unitTypeName: string, pageTextHint: string): boolean {
  const context = `${unitTypeName} ${pageTextHint}`.trim();
  const bathroomContext = hasBathroomContext(context);
  const excludedContext = hasExcludedCounterContext(context);
  const sinkEvidence = Boolean(row.hasSink) || row.bowlOffset != null || (row.bowlPosition && row.bowlPosition !== 'center');

  if (!isVanityDepth(row.depth)) return false;
  if (excludedContext && !bathroomContext) return false;
  if (sinkEvidence) return true;
  if (bathroomContext) return true;
  return false;
}

function sanitizeDetectedType(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (/^(unknown|n\/?a|none|null|empty|tbd|untitled)$/i.test(raw)) return '';
  return raw.replace(/^['"]+|['"]+$/g, '').replace(/\s+/g, ' ').trim();
}

export function extractUnitTypeFromPageText(text: string): string {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  if (!cleaned) return '';

  const patterns = [
    /(?:parcel\s+[a-z0-9]+(?:\s+[a-z0-9]+)*\s+)?type\s*-?\s*([a-z0-9().\/-]+(?:\s+[a-z0-9().\/-]+){0,4})\s+unit#/i,
    /countertops\s+type\s*-?\s*([a-z0-9().\/-]+(?:\s+[a-z0-9().\/-]+){0,4})\s+(?:parcel|unit#)/i,
    /(?:^|[\s-])((?:\d+br|studio|efficiency|penthouse)[a-z0-9().\/\s-]{0,40}?)\s+unit#/i,
    /([a-z0-9][a-z0-9().\/\s-]{1,60}?)\s+countertops\s+drawing\s*#/i,
    /countertops\s+([a-z][a-z0-9().\/-]*(?:\s+[a-z0-9().\/-]+){0,4})\s+(?:\d+(?:\s+\d+\s+\d+)?\s*\"|parcel\s+[a-z0-9]+|type\s+-?)/i,
  ];

  for (const pattern of patterns) {
    const match = cleaned.match(pattern);
    if (!match) continue;
    let candidate = sanitizeDetectedType(match[1]);
    candidate = candidate.replace(/^(?:judd\s+homestead\s*-?\s*ct\s*-?\s*)/i, '').trim();
    candidate = candidate.replace(/\s*(?:no\s+scale|drawing\s*#?.*)$/i, '').trim();
    if (candidate && candidate.length >= 2 && candidate.length <= 60) return candidate;
  }

  return '';
}
