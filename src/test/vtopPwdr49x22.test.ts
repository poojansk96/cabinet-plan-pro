// @vitest-environment node
// Regression: page 9, 2BR - AS, PWDR 49"x22" center-bowl vanity.
// Expected: leftWall=false, rightWall=true, sidesplashCount=1.
// "Both end finish" requires BOTH ends explicitly false — unknown evidence
// must not collapse into a finish end, and a mapped wall=true must never
// be downgraded by the deterministic detector.
import { describe, expect, it } from 'vitest';
import { pageSideForPersonEnd, scoreWallEvidence } from '@/components/project/VtopPDFImportDialog';

describe('VTOP regression — PWDR 49x22 (page 9, 2BR - AS)', () => {
  // Page 9 vanity: backsplash drawn on page-top, center bowl,
  // single line on page-left (finish), double line on page-right (sidesplash).
  const backSideOnPage = 'top' as const;
  const endWallOnPage = { left: false, right: true, top: null, bottom: null };

  it('maps person-perspective ends to the correct page sides', () => {
    expect(pageSideForPersonEnd(backSideOnPage, 'left')).toBe('left');
    expect(pageSideForPersonEnd(backSideOnPage, 'right')).toBe('right');
  });

  it('mapped page-side evidence is preserved end-to-end', () => {
    const leftPS = pageSideForPersonEnd(backSideOnPage, 'left');
    const rightPS = pageSideForPersonEnd(backSideOnPage, 'right');
    const mappedLeft = endWallOnPage[leftPS];   // false → finish end
    const mappedRight = endWallOnPage[rightPS]; // true  → sidesplash

    // Detector slightly disagrees on the right (open-looking crop). Mapped=true
    // must NOT be downgraded — keep wall=true and flag for review.
    const left = scoreWallEvidence(/*det*/ 0.2, /*ai*/ 0.1, mappedLeft);
    const right = scoreWallEvidence(/*det*/ 0.4, /*ai*/ 0.85, mappedRight);

    expect(left.wall).toBe(false);
    expect(right.wall).toBe(true);

    const sidesplashCount = (left.wall ? 1 : 0) + (right.wall ? 1 : 0);
    expect(sidesplashCount).toBe(1);
  });

  it('null mapped evidence does NOT collapse to false (no fake finish end)', () => {
    // If endWallOnPage is unknown for an end and the AI direct hint says wall,
    // we must not silently convert it into a finish end.
    const result = scoreWallEvidence(/*det*/ 0.5, /*ai*/ 0.85, null);
    expect(result.wall).toBe(true);
    expect(result.reviewRequired).toBe(true);
  });

  it('mapped wall=true is never downgraded by a weak detector', () => {
    const r = scoreWallEvidence(/*det*/ 0.1, /*ai*/ 0.1, true);
    expect(r.wall).toBe(true);
    expect(r.reviewRequired).toBe(true);
  });

  it('mapped wall=false is preserved (true finish end)', () => {
    const r = scoreWallEvidence(/*det*/ 0.9, /*ai*/ 0.9, false);
    expect(r.wall).toBe(false);
    expect(r.reviewRequired).toBe(true);
  });
});
