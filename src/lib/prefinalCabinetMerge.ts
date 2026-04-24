export interface ExtractedCabinetPassItem {
  sku?: string;
  room?: string;
  quantity?: number;
  type?: string;
  [key: string]: unknown;
}

export interface PositionedPdfTextItem {
  str?: string;
  transform?: number[];
}

const SKU_PATTERN = /\b(B|DB|SB|CB|EB|LS|LSB|W|WDC|UB|WC|OH|BLB|BLW|BRW|T|TF|UT|TC|PT|PTC|UC|V|VB|VD|VDB|VDC|FIL|BF|WF|BFFIL|WFFIL|TK|TKRUN|CM|LR|EP|FP|DWR|HA|HAV|HAVDB|HAUC|HALC|HAL|HAB|HADB|HABLB|HAOC|HASB|HACB|HAEB|HALS|HALSB|HAWDC|HAW|SA|SV|APPRON|UREP|REP|HCOC|HCUC|HCYC|HCDB|HCLS|HCBMW|HCBM|HCB|HC|HWSB|HWS|HW|HSS|HS)\d[\w\-\/]*(?:\((?:SPLIT)\)|\[(?:SPLIT)\]|_SPLIT)?/gi;
const APPLIANCE_RE = /^(REF|REFRIG|REFRIGERATOR|DW(?!R)|DDW|DISHWASHER|DISHW|RANGE|HOOD|MICRO|OTR|OVEN|COOK|STOVE|MW|WM|WASHER|DRYER|FREEZER|WINE|ICE|TRASH|COMPACT|SINK|FAN|VENT|DISP|CKT)/i;
const SKU_PREFIX_RE = /^[A-Z]{1,8}\d/i;
const NO_DIGIT_OK = /^(BP|SCRIBE|UC)$/i;

type SkuOccurrence = {
  sku: string;
  x: number;
  y: number;
};

export function normalizePrefinalSkuLabel(value: unknown): string {
  return String(value || '')
    .toUpperCase()
    .trim()
    .replace(/\s*-\s*/g, '-')
    .replace(/\s+/g, '')
    .replace(/-+$/g, '');
}

function isValidSku(value: string): boolean {
  const upper = normalizePrefinalSkuLabel(value);
  if (!upper || upper.length < 2) return false;
  if (NO_DIGIT_OK.test(upper)) return true;
  if (APPLIANCE_RE.test(upper)) return false;
  if (/^UNIT\b/i.test(upper) || /^ELEV/i.test(upper) || /^FLOOR/i.test(upper) || /^TYPE\s/i.test(upper)) return false;
  if (upper.includes('/') && !(/^(BLB|BLW|BRW|HABLB)\d/i.test(upper))) return false;
  if (/^X\d+$/i.test(upper)) return false;
  if (/^[A-Z]\d$/i.test(upper)) return false;
  return SKU_PREFIX_RE.test(upper);
}

function extractSkuMatches(text: string): string[] {
  if (!text) return [];

  const matches = text.match(SKU_PATTERN) || [];
  const noDigitMatches = text.match(/\b(BP|SCRIBE|UC)\b/gi) || [];
  const appronMatches: string[] = [];
  let appronMatch: RegExpExecArray | null;
  const appronPattern = /\bAPPRON\s+(\d+X\d+)\b/gi;
  while ((appronMatch = appronPattern.exec(text)) !== null) {
    appronMatches.push(`APPRON${appronMatch[1]}`);
  }

  return [...matches, ...noDigitMatches, ...appronMatches]
    .map(normalizePrefinalSkuLabel)
    .filter((sku) => isValidSku(sku));
}

function countOccurrences(occurrences: SkuOccurrence[]): Record<string, number> {
  return occurrences.reduce<Record<string, number>>((acc, occurrence) => {
    acc[occurrence.sku] = (acc[occurrence.sku] ?? 0) + 1;
    return acc;
  }, {});
}

function getBounds(occurrences: SkuOccurrence[]) {
  const xs = occurrences.map(({ x }) => x);
  const ys = occurrences.map(({ y }) => y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  return {
    minX,
    maxX,
    minY,
    maxY,
    spanX: Math.max(1, maxX - minX),
    spanY: Math.max(1, maxY - minY),
  };
}

function pickPrimaryPlanCluster(occurrences: SkuOccurrence[]): SkuOccurrence[] {
  if (occurrences.length <= 2) return occurrences;

  const allBounds = getBounds(occurrences);
  const xThreshold = Math.max(40, allBounds.spanX * 0.18);
  const yThreshold = Math.max(40, allBounds.spanY * 0.18);
  const visited = new Set<number>();
  const components: SkuOccurrence[][] = [];

  for (let index = 0; index < occurrences.length; index += 1) {
    if (visited.has(index)) continue;

    const stack = [index];
    const component: SkuOccurrence[] = [];
    visited.add(index);

    while (stack.length > 0) {
      const current = stack.pop()!;
      const node = occurrences[current];
      component.push(node);

      for (let next = 0; next < occurrences.length; next += 1) {
        if (visited.has(next)) continue;
        const candidate = occurrences[next];
        if (Math.abs(node.x - candidate.x) <= xThreshold && Math.abs(node.y - candidate.y) <= yThreshold) {
          visited.add(next);
          stack.push(next);
        }
      }
    }

    components.push(component);
  }

  if (components.length <= 1) return occurrences;

  return components.sort((left, right) => {
    if (right.length !== left.length) return right.length - left.length;
    const rightUnique = new Set(right.map(({ sku }) => sku)).size;
    const leftUnique = new Set(left.map(({ sku }) => sku)).size;
    if (rightUnique !== leftUnique) return rightUnique - leftUnique;
    const rightBounds = getBounds(right);
    const leftBounds = getBounds(left);
    const rightArea = rightBounds.spanX * rightBounds.spanY;
    const leftArea = leftBounds.spanX * leftBounds.spanY;
    return rightArea - leftArea;
  })[0];
}

export function extractPlanSkuCountsFromTextItems(textItems: PositionedPdfTextItem[]): Record<string, number> {
  const occurrences: SkuOccurrence[] = [];

  for (const item of textItems) {
    const text = String(item?.str || '');
    if (!text.trim()) continue;

    const x = Array.isArray(item?.transform) ? Number(item.transform[4] ?? 0) : 0;
    const y = Array.isArray(item?.transform) ? Number(item.transform[5] ?? 0) : 0;

    for (const sku of extractSkuMatches(text)) {
      occurrences.push({ sku, x, y });
    }
  }

  if (occurrences.length === 0) return {};

  const primaryCluster = pickPrimaryPlanCluster(occurrences);
  if (primaryCluster.length === occurrences.length) {
    return countOccurrences(occurrences);
  }

  const bounds = getBounds(primaryCluster);
  const marginX = Math.max(24, bounds.spanX * 0.08);
  const marginY = Math.max(24, bounds.spanY * 0.08);
  const clusteredOccurrences = occurrences.filter(({ x, y }) =>
    x >= bounds.minX - marginX &&
    x <= bounds.maxX + marginX &&
    y >= bounds.minY - marginY &&
    y <= bounds.maxY + marginY,
  );

  return countOccurrences(clusteredOccurrences.length > 0 ? clusteredOccurrences : primaryCluster);
}

function isAmbiguousDirectionalUcSku(value: unknown): boolean {
  return /^UC\d+X\d+-[LR]$/i.test(String(value || '').trim());
}

function stripDirectionalSuffix(value: unknown): string {
  return normalizePrefinalSkuLabel(String(value || '')).replace(/-[LR]$/i, '');
}

export function mergePrefinalExtractionPasses(
  passes: ExtractedCabinetPassItem[][],
  planTextSkuCounts: Record<string, number> = {},
): ExtractedCabinetPassItem[] {
  if (!passes.length) return [];

  const map = new Map<string, ExtractedCabinetPassItem>();
  const stripOnly = new Map<string, { item: ExtractedCabinetPassItem; support: number; maxQty: number }>();
  const stripStats = new Map<string, { support: number; maxQty: number }>();
  const qtyObservations = new Map<string, number[]>();

  const keyOf = (item: ExtractedCabinetPassItem) =>
    `${normalizePrefinalSkuLabel(item.sku)}|${String(item.room || 'Kitchen')}`;
  const isHavSku = (sku: string) => /^HAV\d|^HAVDB\d/i.test(normalizePrefinalSkuLabel(sku));
  const isRoomFragileManufacturerSku = (sku: string) => /^(?:HAV\d|HAVDB\d|HC|HS|HW)/i.test(normalizePrefinalSkuLabel(sku));
  const recordQtyObservation = (key: string, qty: number) => {
    const existing = qtyObservations.get(key) ?? [];
    existing.push(Math.max(1, qty || 1));
    qtyObservations.set(key, existing);
  };
  const roomPriorityForDirectionalCollapse = (room: string): number => {
    const normalized = String(room || '').trim().toLowerCase();
    if (normalized === 'kitchen') return 0;
    if (normalized === 'bath') return 1;
    if (normalized === 'laundry') return 2;
    if (normalized === 'pantry') return 3;
    if (normalized === 'other') return 4;
    return 5;
  };

  const findExistingSkuKeys = (sku: string): string[] => {
    const upper = normalizePrefinalSkuLabel(sku);
    if (!upper) return [];
    return Array.from(map.keys()).filter((existingKey) => existingKey.startsWith(`${upper}|`));
  };

  for (const item of passes[0] ?? []) {
    if (!item?.sku) continue;
    const key = keyOf(item);
    const existing = map.get(key);
    if (existing) {
      existing.quantity = Math.max(Number(existing.quantity) || 1, Number(item.quantity) || 1);
    } else {
      map.set(key, { ...item });
    }
  }

  for (const [key, item] of map.entries()) {
    recordQtyObservation(key, Number(item.quantity) || 1);
  }

  for (const items of passes.slice(1)) {
    const seenInThisStrip = new Set<string>();
    const passMaxQtyByKey = new Map<string, number>();

    for (const item of items) {
      if (!item?.sku) continue;
      const key = keyOf(item);
      const qty = Math.max(1, Number(item.quantity) || 1);
      const stats = stripStats.get(key) ?? { support: 0, maxQty: 0 };

      if (!seenInThisStrip.has(key)) {
        stats.support += 1;
      }
      stats.maxQty = Math.max(stats.maxQty, qty);
      stripStats.set(key, stats);
      passMaxQtyByKey.set(key, Math.max(passMaxQtyByKey.get(key) ?? 0, qty));

      const existing = map.get(key);
      if (existing) {
        existing.quantity = Math.max(Number(existing.quantity) || 1, qty);
        seenInThisStrip.add(key);
        continue;
      }

      if (isHavSku(String(item.sku)) || isRoomFragileManufacturerSku(String(item.sku))) {
        const existingSkuKeys = findExistingSkuKeys(String(item.sku));
        if (existingSkuKeys.length === 1) {
          const existingSkuRow = map.get(existingSkuKeys[0]);
          if (existingSkuRow) {
            existingSkuRow.quantity = Math.max(Number(existingSkuRow.quantity) || 1, qty);
            seenInThisStrip.add(key);
            continue;
          }
        }
      }

      const candidate = stripOnly.get(key) ?? { item: { ...item }, support: 0, maxQty: 0 };
      if (!seenInThisStrip.has(key)) candidate.support += 1;
      candidate.maxQty = Math.max(candidate.maxQty, qty);
      stripOnly.set(key, candidate);
      seenInThisStrip.add(key);
    }

    for (const [key, qty] of passMaxQtyByKey.entries()) {
      recordQtyObservation(key, qty);
    }
  }

  const isStrongStripOnlySku = (sku: string): boolean => {
    const upper = String(sku || '').toUpperCase().trim();
    return /^(UC|BP|SCRIBE)$/.test(upper)
      || /^(?:DWR|BF|FIL|CM|EP|FP|LR)\d(?:[A-Z0-9\-\/]*)$/.test(upper)
      // Filler-head base cabinets like B09FH, B06FH, B12FH, B15FH, B18FH —
      // very narrow rectangles drawn beside vanities; commonly only seen on a
      // single strip pass but always real when present.
      || /^B\d{1,2}FH$/.test(upper)
      || /^[A-Z]{2,8}\d[A-Z0-9\-\/]{2,}$/.test(upper);
  };

  const isShortAccessorySku = (sku: string): boolean => {
    const upper = String(sku || '').toUpperCase().trim();
    return /^(?:DWR|BF|WF|FIL|CM|EP|FP|LR|TK|TF|APPRON)\d/i.test(upper);
  };

  for (const [key, candidate] of stripOnly.entries()) {
    const sku = String(candidate.item?.sku || '');
    const accepted = candidate.support >= 2
      || (candidate.support >= 1 && isStrongStripOnlySku(sku))
      || (candidate.support >= 1 && isShortAccessorySku(sku));

    if (!accepted) continue;

    if (isHavSku(sku) || isRoomFragileManufacturerSku(sku)) {
      const existingSkuKeys = findExistingSkuKeys(sku);
      if (existingSkuKeys.length === 1) {
        const existingSkuRow = map.get(existingSkuKeys[0]);
        if (existingSkuRow) {
          existingSkuRow.quantity = Math.max(Number(existingSkuRow.quantity) || 1, candidate.maxQty);
          continue;
        }
      }
    }

    map.set(key, {
      ...candidate.item,
      quantity: Math.max(Number(candidate.item.quantity) || 1, candidate.maxQty),
    });
  }

  const keysBySku = new Map<string, string[]>();
  for (const [key, item] of map.entries()) {
    const normalizedSku = normalizePrefinalSkuLabel(item.sku);
    if (!normalizedSku) continue;
    const keys = keysBySku.get(normalizedSku) ?? [];
    keys.push(key);
    keysBySku.set(normalizedSku, keys);
  }

  for (const [sku, keys] of keysBySku.entries()) {
    if (keys.length !== 1) continue;

    const planTextCount = planTextSkuCounts[sku] ?? 0;
    if (planTextCount <= 0) continue;

    const key = keys[0];
    const existing = map.get(key);
    if (!existing) continue;

    const currentQty = Math.max(1, Number(existing.quantity) || 1);
    const support = stripStats.get(key)?.support ?? 0;
    const observedQtys = qtyObservations.get(key) ?? [currentQty];
    const reinforcingHighQtyPasses = observedQtys.filter((qty) => qty >= Math.max(2, currentQty - 1)).length;

    // Promote up: text layer shows one more than AI detected, with enough confidence
    const canPromoteByOne = planTextCount === currentQty + 1 && (currentQty >= 3 || support >= 3);
    if (canPromoteByOne) {
      existing.quantity = planTextCount;
    }

    // Cap down carefully:
    // - still trim obvious small overcounts (2 → 1)
    // - allow bigger quantities (3+) to survive ONLY when the higher count is reinforced
    //   by another pass at the same or nearly the same quantity
    // This blocks single-pass hallucinated qty=3 cases while preserving real repeated labels
    // like W2430B 3,2,1 where the plan-text cluster only saw one label.
    const hasReliableHighQtySupport = currentQty >= 3 && reinforcingHighQtyPasses >= 2;
    const shouldCapDown = currentQty > planTextCount
      && planTextCount >= 1
      && (currentQty <= 2 || !hasReliableHighQtySupport);
    if (shouldCapDown) {
      existing.quantity = planTextCount;
    }
  }

  const mergedRows = Array.from(map.values());
  const groupedDirectionalUc = new Map<string, ExtractedCabinetPassItem[]>();

  for (const row of mergedRows) {
    if (!isAmbiguousDirectionalUcSku(row.sku)) continue;
    const base = stripDirectionalSuffix(row.sku);
    const group = groupedDirectionalUc.get(base) ?? [];
    group.push(row);
    groupedDirectionalUc.set(base, group);
  }

  const collapsedBases = new Set<string>();
  const output: ExtractedCabinetPassItem[] = [];

  for (const row of mergedRows) {
    const normalizedSku = normalizePrefinalSkuLabel(row.sku);
    const base = stripDirectionalSuffix(row.sku);
    const group = groupedDirectionalUc.get(base) ?? [];

    if (isAmbiguousDirectionalUcSku(row.sku) && group.length >= 2) {
      const suffixes = new Set(group.map((item) => normalizePrefinalSkuLabel(item.sku).match(/-([LR])$/i)?.[1]));
      const hasLeftAndRight = suffixes.has('L') && suffixes.has('R');
      const qtysAreSingle = group.every((item) => Math.max(1, Number(item.quantity) || 1) === 1);
      const exactDirectionalCount = (planTextSkuCounts[`${base}-L`] ?? 0) + (planTextSkuCounts[`${base}-R`] ?? 0);
      const baseCount = planTextSkuCounts[base] ?? 0;
      const totalDirectionalEvidence = exactDirectionalCount + baseCount;

      if (hasLeftAndRight && qtysAreSingle && totalDirectionalEvidence <= 1) {
        if (!collapsedBases.has(base)) {
          const preferred = group.reduce((best, current) => {
            if (!best) return current;
            return roomPriorityForDirectionalCollapse(String(current.room || 'Kitchen')) < roomPriorityForDirectionalCollapse(String(best.room || 'Kitchen'))
              ? current
              : best;
          }, group[0]);

          output.push({
            ...preferred,
            sku: `${base}-`,
            quantity: Math.max(1, baseCount),
          });
          collapsedBases.add(base);
        }
        continue;
      }
    }

    if (!collapsedBases.has(base) || !isAmbiguousDirectionalUcSku(normalizedSku)) {
      output.push(row);
    }
  }

  // ── Phantom substring filter (cross-pass) ──
  // The AI vision passes sometimes misread a long manufacturer SKU like
  // "HASB36B-REM" as the bare suffix "SB36B-REM" on a single strip pass. The
  // edge function already strips these per-pass, but when separate strips
  // independently return the suffix and the full SKU, the merged output ends up
  // containing both. Drop the bare suffix when:
  //   1. it is a strict suffix of another extracted SKU (e.g. SB36B-REM is the
  //      suffix of HASB36B-REM, B09FH is NOT a suffix of HAB09FH, etc.), AND
  //   2. the plan text layer does NOT independently confirm the bare suffix.
  // We only drop low-quantity (≤1) marginal detections to stay safe.
  const finalSkus = output.map((row) => normalizePrefinalSkuLabel(row.sku));
  const filteredOutput = output.filter((row, index) => {
    const sku = finalSkus[index];
    if (!sku) return true;
    const qty = Math.max(1, Number(row.quantity) || 1);
    if (qty > 1) return true;

    const isSuffixOfOther = finalSkus.some((other, otherIndex) => {
      if (otherIndex === index) return false;
      if (!other || other.length <= sku.length) return false;
      return other.endsWith(sku);
    });
    if (!isSuffixOfOther) return true;

    const planConfirmed = (planTextSkuCounts[sku] ?? 0) >= 1;
    if (planConfirmed) return true;

    return false;
  });

  return filteredOutput;
}