// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { detectDoubleLineAtEdge } from '@/components/project/VtopPDFImportDialog';

function makeImageData(width: number, height: number, lines: { side: 'left' | 'right' | 'top' | 'bottom'; offset: number }[]): ImageData {
  const data = new Uint8ClampedArray(width * height * 4).fill(255);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  for (const line of lines) {
    if (line.side === 'left' || line.side === 'right') {
      const x = line.side === 'left' ? line.offset : width - 1 - line.offset;
      for (let y = 0; y < height; y++) {
        const idx = (y * width + x) * 4;
        data[idx] = data[idx + 1] = data[idx + 2] = 0;
      }
    } else {
      const y = line.side === 'top' ? line.offset : height - 1 - line.offset;
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        data[idx] = data[idx + 1] = data[idx + 2] = 0;
      }
    }
  }
  return { data, width, height, colorSpace: 'srgb' } as ImageData;
}

describe('VTOP wall line detector', () => {
  it('treats one line as open finish end, not uncertain wall', () => {
    expect(detectDoubleLineAtEdge(makeImageData(40, 120, [{ side: 'left', offset: 0 }]), 'left')).toBeLessThan(0.25);
    expect(detectDoubleLineAtEdge(makeImageData(120, 40, [{ side: 'top', offset: 0 }]), 'top')).toBeLessThan(0.25);
  });

  it('treats two close parallel lines as a wall / sidesplash', () => {
    expect(detectDoubleLineAtEdge(makeImageData(40, 120, [{ side: 'right', offset: 0 }, { side: 'right', offset: 4 }]), 'right')).toBeGreaterThan(0.75);
    expect(detectDoubleLineAtEdge(makeImageData(120, 40, [{ side: 'bottom', offset: 0 }, { side: 'bottom', offset: 4 }]), 'bottom')).toBeGreaterThan(0.75);
  });

  it('keeps center-bowl tops with one open end and one sidesplash from becoming both finish', () => {
    expect(detectDoubleLineAtEdge(makeImageData(80, 120, [{ side: 'left', offset: 0 }]), 'left')).toBeLessThan(0.25);
    expect(detectDoubleLineAtEdge(makeImageData(80, 120, [{ side: 'right', offset: 0 }, { side: 'right', offset: 5 }]), 'right')).toBeGreaterThan(0.75);
  });
});
