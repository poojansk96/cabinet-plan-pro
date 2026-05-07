// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { pageSideForPersonEnd } from '@/components/project/VtopPDFImportDialog';

describe('VTOP finish-end perspective mapping', () => {
  it('maps vertical vanities with backsplash on page-left correctly', () => {
    expect(pageSideForPersonEnd('left', 'left')).toBe('bottom');
    expect(pageSideForPersonEnd('left', 'right')).toBe('top');
  });

  it('maps vertical mirror vanities with backsplash on page-right correctly', () => {
    expect(pageSideForPersonEnd('right', 'left')).toBe('top');
    expect(pageSideForPersonEnd('right', 'right')).toBe('bottom');
  });

  it('maps horizontal vanities from front-facing perspective', () => {
    expect(pageSideForPersonEnd('top', 'left')).toBe('left');
    expect(pageSideForPersonEnd('top', 'right')).toBe('right');
    expect(pageSideForPersonEnd('bottom', 'left')).toBe('right');
    expect(pageSideForPersonEnd('bottom', 'right')).toBe('left');
  });
});
