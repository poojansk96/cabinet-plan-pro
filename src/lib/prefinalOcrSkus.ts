import { extractSkuMatches, normalizePrefinalSkuLabel } from './prefinalCabinetMerge';

/**
 * Browser-only OCR fallback for Prefinal cabinet counting.
 *
 * 2020 Design / ProKitchen plan views print run labels rotated 90/180/270 degrees
 * (e.g. "3xDB24" between two vanity sinks). Vision models regularly miss those glyph
 * runs, and raster-only PDFs have no text layer to fall back on. This module rasterises
 * the page at four orientations, OCRs each one, and returns SKU counts that can be fed
 * into the same corroboration path as PDF text-layer SKUs.
 *
 * tesseract.js is heavy, so it is imported lazily and only used when the page has no
 * usable text layer.
 */

const ROTATIONS = [0, 90, 180, 270] as const;

type AnyCanvas = OffscreenCanvas | HTMLCanvasElement;

function makeCanvas(w: number, h: number): AnyCanvas {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function rotateCanvas(source: AnyCanvas, w: number, h: number, degrees: number): AnyCanvas {
  if (degrees === 0) return source;
  const swap = degrees === 90 || degrees === 270;
  const outW = swap ? h : w;
  const outH = swap ? w : h;
  const out = makeCanvas(outW, outH);
  const ctx = (out as HTMLCanvasElement).getContext('2d') as CanvasRenderingContext2D;
  ctx.translate(outW / 2, outH / 2);
  ctx.rotate((degrees * Math.PI) / 180);
  ctx.drawImage(source as CanvasImageSource, -w / 2, -h / 2, w, h);
  return out;
}

async function canvasToBlob(canvas: AnyCanvas): Promise<Blob> {
  if (typeof OffscreenCanvas !== 'undefined' && canvas instanceof OffscreenCanvas) {
    return canvas.convertToBlob({ type: 'image/png' });
  }
  return new Promise<Blob>((resolve, reject) => {
    (canvas as HTMLCanvasElement).toBlob((blob) => (blob ? resolve(blob) : reject(new Error('toBlob failed'))), 'image/png');
  });
}

/**
 * Expands multiplier notation into a sku/qty pair: "3xDB24" -> { sku: 'DB24', qty: 3 }.
 */
export function parseOcrSkuToken(token: string): { sku: string; qty: number } | null {
  const raw = String(token || '').trim();
  if (!raw) return null;
  const mult = raw.match(/^(\d{1,2})\s*[xX\u00d7vV*]\s*([A-Za-z]{1,6}\d[\w.\-\/]*)$/);
  const body = mult ? mult[2] : raw;
  const qty = mult ? Math.max(1, parseInt(mult[1], 10) || 1) : 1;
  const matches = extractSkuMatches(body);
  if (matches.length === 0) return null;
  return { sku: normalizePrefinalSkuLabel(matches[0]), qty };
}

/**
 * Runs OCR over the page canvas at 0/90/180/270 degrees and returns SKU -> count.
 * The count for each SKU is the MAX seen across orientations (never the sum), because
 * the same label is read repeatedly, once per orientation.
 */
export async function ocrPlanSkuCountsFromCanvas(
  canvas: AnyCanvas,
  width: number,
  height: number,
): Promise<Record<string, number>> {
  if (typeof window === 'undefined') return {};

  let createWorker: typeof import('tesseract.js')['createWorker'];
  try {
    ({ createWorker } = await import('tesseract.js'));
  } catch (e) {
    console.warn('OCR fallback unavailable (tesseract.js failed to load):', e);
    return {};
  }

  const counts: Record<string, number> = {};
  let worker: Awaited<ReturnType<typeof createWorker>> | null = null;

  try {
    worker = await createWorker('eng');
    await worker.setParameters({
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-.x/',
    });

    for (const degrees of ROTATIONS) {
      const rotated = rotateCanvas(canvas, width, height, degrees);
      let text = '';
      try {
        const blob = await canvasToBlob(rotated);
        const { data } = await worker.recognize(blob as Blob);
        text = String(data?.text || '');
      } catch (e) {
        console.warn(`OCR pass ${degrees}° failed:`, e);
        continue;
      }

      const perRotation: Record<string, number> = {};
      for (const token of text.split(/\s+/)) {
        const parsed = parseOcrSkuToken(token);
        if (!parsed) continue;
        perRotation[parsed.sku] = (perRotation[parsed.sku] ?? 0) + parsed.qty;
      }
      for (const [sku, count] of Object.entries(perRotation)) {
        counts[sku] = Math.max(counts[sku] ?? 0, count);
      }
    }
  } catch (e) {
    console.warn('OCR fallback failed:', e);
  } finally {
    try {
      await worker?.terminate();
    } catch {
      /* ignore */
    }
  }

  return counts;
}
