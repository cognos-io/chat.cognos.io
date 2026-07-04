import fc from 'fast-check';
import { describe, expect, it } from 'vitest';

import {
  Edge,
  Placement,
  Point,
  RectLike,
  Triangle,
  edgeCorners,
  facingEdge,
  facingEdgeFromPoint,
  hoverFunnel,
  placePopover,
  pointInTriangle,
  rectsIntersect,
} from './hover-intent-geometry';

const rect = (left: number, top: number, right: number, bottom: number): RectLike => ({
  left,
  top,
  right,
  bottom,
});

describe('pointInTriangle', () => {
  const tri: Triangle = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 0, y: 10 },
  ];

  const cases: { name: string; p: Point; expected: boolean }[] = [
    { name: 'clearly inside', p: { x: 2, y: 2 }, expected: true },
    { name: 'clearly outside', p: { x: 8, y: 8 }, expected: false },
    { name: 'on an edge', p: { x: 5, y: 0 }, expected: true },
    { name: 'on a vertex', p: { x: 0, y: 10 }, expected: true },
    { name: 'far away', p: { x: -50, y: -50 }, expected: false },
  ];

  for (const { name, p, expected } of cases) {
    it(`${name} → ${expected}`, () => {
      expect(pointInTriangle(p, tri)).toBe(expected);
    });
  }

  it('does not throw for a degenerate (zero-area) triangle', () => {
    const degenerate: Triangle = [
      { x: 1, y: 1 },
      { x: 1, y: 1 },
      { x: 1, y: 1 },
    ];
    expect(() => pointInTriangle({ x: 5, y: 5 }, degenerate)).not.toThrow();
  });
});

describe('facingEdge (rect → rect)', () => {
  const trigger = rect(100, 100, 120, 116);
  const cases: { name: string; to: RectLike; expected: Edge }[] = [
    { name: 'popover below → top edge', to: rect(100, 140, 300, 220), expected: 'top' },
    {
      name: 'popover above → bottom edge',
      to: rect(100, 0, 300, 80),
      expected: 'bottom',
    },
    {
      name: 'popover right → left edge',
      to: rect(160, 100, 360, 180),
      expected: 'left',
    },
    {
      name: 'popover left → right edge',
      to: rect(-260, 100, -60, 180),
      expected: 'right',
    },
    // Diagonal (below-and-right, as in the citation card screenshot): the
    // vertical gap dominates → top edge, matching the funnel we want.
    {
      name: 'below-and-right diagonal → top edge',
      to: rect(140, 150, 340, 230),
      expected: 'top',
    },
  ];
  for (const { name, to, expected } of cases) {
    it(name, () => {
      expect(facingEdge(trigger, to)).toBe(expected);
    });
  }
});

describe('edgeCorners', () => {
  const r = rect(10, 20, 110, 60);
  it('top edge corners', () => {
    expect(edgeCorners(r, 'top')).toEqual([
      { x: 10, y: 20 },
      { x: 110, y: 20 },
    ]);
  });
  it('bottom edge corners', () => {
    expect(edgeCorners(r, 'bottom')).toEqual([
      { x: 10, y: 60 },
      { x: 110, y: 60 },
    ]);
  });
  it('left edge corners', () => {
    expect(edgeCorners(r, 'left')).toEqual([
      { x: 10, y: 20 },
      { x: 10, y: 60 },
    ]);
  });
  it('right edge corners', () => {
    expect(edgeCorners(r, 'right')).toEqual([
      { x: 110, y: 20 },
      { x: 110, y: 60 },
    ]);
  });
});

describe('hoverFunnel', () => {
  it('below-right card: apex + top-edge corners; a diagonal move stays inside', () => {
    const apex: Point = { x: 100, y: 100 };
    const card = rect(120, 140, 320, 240); // below and to the right
    const tri = hoverFunnel(apex, card);
    expect(tri[0]).toEqual(apex);
    expect(tri[1]).toEqual({ x: 120, y: 140 }); // top-left
    expect(tri[2]).toEqual({ x: 320, y: 140 }); // top-right
    // A point on the way from the marker into the card stays in the funnel.
    expect(pointInTriangle({ x: 150, y: 130 }, tri)).toBe(true);
    // A point sideways (perpendicular, away from the card) is outside.
    expect(pointInTriangle({ x: 40, y: 105 }, tri)).toBe(false);
  });

  it('handles a zero-size popover without throwing', () => {
    const apex: Point = { x: 0, y: 0 };
    const empty = rect(50, 50, 50, 50);
    expect(() => hoverFunnel(apex, empty)).not.toThrow();
  });
});

describe('placePopover', () => {
  const viewport = { width: 1000, height: 800 };
  const size = { width: 320, height: 120 };

  it('keeps the preferred side when it fits', () => {
    const trigger = rect(400, 400, 420, 416);
    const { placement } = placePopover(trigger, size, viewport, { placement: 'top' });
    expect(placement).toBe('top');
  });

  it('flips above when the preferred bottom side does not fit', () => {
    // Trigger hugs the bottom edge; bottom placement can't fit → flip to top.
    const trigger = rect(400, 760, 420, 776);
    const { placement, rect: out } = placePopover(trigger, size, viewport, {
      placement: 'bottom',
      margin: 8,
    });
    expect(placement).toBe('top');
    expect(out.bottom).toBeLessThanOrEqual(viewport.height - 8);
  });

  it('shifts left when the trigger is near the right edge', () => {
    // Aligning the card's left to the trigger would overflow the right edge;
    // it must shift left so the right edge stays within the margin.
    const trigger = rect(950, 400, 970, 416);
    const { rect: out, placement } = placePopover(trigger, size, viewport, {
      placement: 'top',
      margin: 8,
    });
    expect(placement).toBe('top');
    expect(out.right).toBeLessThanOrEqual(viewport.width - 8);
    expect(out.left).toBeGreaterThanOrEqual(8);
  });

  it('corner (bottom-right): flips above AND shifts left', () => {
    const trigger = rect(950, 760, 970, 776);
    const { placement, rect: out } = placePopover(trigger, size, viewport, {
      placement: 'bottom',
      margin: 8,
    });
    expect(placement).toBe('top');
    expect(out.right).toBeLessThanOrEqual(viewport.width - 8);
    expect(out.bottom).toBeLessThanOrEqual(viewport.height - 8);
    expect(out.left).toBeGreaterThanOrEqual(8);
    expect(out.top).toBeGreaterThanOrEqual(8);
  });

  it('pins an over-large popover to the near margin (degenerate)', () => {
    const trigger = rect(10, 10, 30, 26);
    const huge = { width: 2000, height: 2000 };
    const { rect: out } = placePopover(trigger, huge, viewport, { margin: 8 });
    expect(out.left).toBe(8);
    expect(out.top).toBe(8);
  });

  // Regression (user screenshot): a top-edge trigger with placement 'top' used
  // to clamp the card back down ONTO the number. It must flip below instead.
  it('never covers the trigger: top-edge trigger + placement top flips below', () => {
    const trigger = rect(200, 4, 220, 22); // hugging the top edge
    const { placement, rect: out } = placePopover(trigger, size, viewport, {
      placement: 'top',
      gap: 6,
      margin: 8,
    });
    expect(placement).toBe('bottom');
    expect(rectsIntersect(out, trigger)).toBe(false);
    expect(out.top).toBeGreaterThanOrEqual(trigger.bottom); // sits fully below
  });

  it('picks a perpendicular side when both vertical sides are blocked', () => {
    // Tiny viewport: a tall card fits neither above nor below the trigger, but
    // there is room to the right → the card must go beside it, not over it.
    const tinyViewport = { width: 400, height: 300 };
    const trigger = rect(10, 10, 30, 26);
    const tall = { width: 200, height: 280 };
    const { placement, rect: out } = placePopover(trigger, tall, tinyViewport, {
      placement: 'top',
      gap: 6,
      margin: 8,
    });
    expect(placement).toBe('right');
    expect(rectsIntersect(out, trigger)).toBe(false);
    expect(out.left).toBeGreaterThanOrEqual(trigger.right); // sits fully to the right
  });

  it('keeps the full gap: a top placement clamped to within the gap flips below', () => {
    // 'top' at the full gap would poke above the margin, so it clamps down to
    // margin — leaving only a 2px gap to the trigger (no overlap, but < gap).
    // That is not good enough: it must flip below to keep the configured gap.
    const trigger = rect(200, 130, 220, 150);
    const { placement, rect: out } = placePopover(trigger, size, viewport, {
      placement: 'top',
      gap: 6,
      margin: 8,
    });
    expect(placement).toBe('bottom');
    expect(out.top - trigger.bottom).toBeGreaterThanOrEqual(6); // ≥ gap clearance
  });

  it('degenerate fallback: no side fits → roomiest side, clamped, still in-viewport', () => {
    // Centred trigger in a tiny viewport with a card too big for every side:
    // no placement can clear it, so we accept some overlap but the rect must
    // still stay fully inside the viewport.
    const tinyViewport = { width: 260, height: 260 };
    const trigger = rect(120, 120, 140, 140);
    const big = { width: 240, height: 240 };
    const { rect: out } = placePopover(trigger, big, tinyViewport, {
      gap: 6,
      margin: 8,
    });
    expect(out.left).toBeGreaterThanOrEqual(8);
    expect(out.top).toBeGreaterThanOrEqual(8);
    expect(out.right).toBeLessThanOrEqual(tinyViewport.width - 8);
    expect(out.bottom).toBeLessThanOrEqual(tinyViewport.height - 8);
  });
});

// --- Property tests ---------------------------------------------------------

const finite = (min: number, max: number): fc.Arbitrary<number> =>
  fc.integer({ min, max });

// A trigger rect somewhere inside a 1000x800 viewport.
const triggerArb: fc.Arbitrary<RectLike> = fc
  .record({
    left: finite(0, 960),
    top: finite(0, 760),
    w: finite(1, 40),
    h: finite(1, 40),
  })
  .map(({ left, top, w, h }) => rect(left, top, left + w, top + h));

describe('property: hoverFunnel + pointInTriangle', () => {
  it('a strictly-interior point of the funnel is reported inside', () => {
    fc.assert(
      fc.property(
        // popover somewhere below the pointer, with real size
        fc.record({
          left: finite(0, 700),
          top: finite(200, 700),
          w: finite(1, 300),
          h: finite(1, 100),
        }),
        finite(0, 300), // how far above the popover the apex sits (>0 → non-degenerate)
        // strictly-positive barycentric weights → strictly interior point
        finite(1, 100),
        finite(1, 100),
        finite(1, 100),
        (p, above, wa, wb, wc) => {
          const rectP = rect(p.left, p.top, p.left + p.w, p.top + p.h);
          // Apex directly above the popover so the facing edge is the top edge
          // and the triangle has positive area.
          const apex: Point = { x: p.left + Math.floor(p.w / 2), y: p.top - above - 1 };
          const [a, b, c] = hoverFunnel(apex, rectP);
          const sum = wa + wb + wc;
          const inside: Point = {
            x: (wa * a.x + wb * b.x + wc * c.x) / sum,
            y: (wa * a.y + wb * b.y + wc * c.y) / sum,
          };
          expect(pointInTriangle(inside, [a, b, c])).toBe(true);
        },
      ),
    );
  });

  it('a point behind the apex (away from the popover) is outside', () => {
    fc.assert(
      fc.property(triggerArb, finite(20, 300), finite(20, 300), (popover, w, h) => {
        // Apex offset from the popover centre; the "behind" point is further
        // along that same outward direction, so it can never be in the funnel.
        const rectP = rect(
          popover.left,
          popover.top,
          popover.left + w,
          popover.top + h,
        );
        const cx = (rectP.left + rectP.right) / 2;
        const cy = (rectP.top + rectP.bottom) / 2;
        const apex: Point = { x: cx - 200, y: cy - 200 };
        const tri = hoverFunnel(apex, rectP);
        const behind: Point = { x: apex.x - 100, y: apex.y - 100 };
        expect(pointInTriangle(behind, tri)).toBe(false);
      }),
    );
  });

  it('never throws for degenerate (zero-size) rects', () => {
    fc.assert(
      fc.property(
        finite(-500, 500),
        finite(-500, 500),
        finite(0, 1000),
        finite(0, 800),
        (rx, ry, px, py) => {
          const empty = rect(rx, ry, rx, ry);
          expect(() => hoverFunnel({ x: px, y: py }, empty)).not.toThrow();
          expect(() =>
            pointInTriangle({ x: px, y: py }, hoverFunnel({ x: px, y: py }, empty)),
          ).not.toThrow();
        },
      ),
    );
  });
});

describe('property: placePopover stays in the viewport', () => {
  const placements: Placement[] = ['top', 'bottom', 'left', 'right'];

  it('output rect is fully within the viewport (margin) for any fitting popover', () => {
    fc.assert(
      fc.property(
        triggerArb,
        finite(1, 900), // width ≤ viewport - 2*margin (1000 - 16 = 984)
        finite(1, 700), // height ≤ viewport - 2*margin (800 - 16 = 784)
        fc.constantFrom(...placements),
        (trigger, w, h, placement) => {
          const viewport = { width: 1000, height: 800 };
          const margin = 8;
          const { rect: out } = placePopover(
            trigger,
            { width: w, height: h },
            viewport,
            {
              placement,
              margin,
            },
          );
          expect(out.left).toBeGreaterThanOrEqual(margin);
          expect(out.top).toBeGreaterThanOrEqual(margin);
          expect(out.right).toBeLessThanOrEqual(viewport.width - margin);
          expect(out.bottom).toBeLessThanOrEqual(viewport.height - margin);
        },
      ),
    );
  });

  it('never intersects the trigger nor the viewport when a side has room', () => {
    // Popover ≤ 300 in a 1000x800 viewport → at least one side always has room
    // for any small trigger, so the result must be a real (non-overlapping) fit.
    fc.assert(
      fc.property(
        triggerArb,
        finite(1, 300),
        finite(1, 300),
        fc.constantFrom(...placements),
        (trigger, w, h, placement) => {
          const viewport = { width: 1000, height: 800 };
          const margin = 8;
          const { rect: out } = placePopover(
            trigger,
            { width: w, height: h },
            viewport,
            {
              placement,
              margin,
            },
          );
          // In-viewport …
          expect(out.left).toBeGreaterThanOrEqual(margin);
          expect(out.top).toBeGreaterThanOrEqual(margin);
          expect(out.right).toBeLessThanOrEqual(viewport.width - margin);
          expect(out.bottom).toBeLessThanOrEqual(viewport.height - margin);
          // … and never covering the trigger.
          expect(rectsIntersect(out, trigger)).toBe(false);
        },
      ),
    );
  });

  it('an over-large popover clamps to the near margin without throwing', () => {
    fc.assert(
      fc.property(
        triggerArb,
        finite(1001, 4000),
        finite(801, 4000),
        (trigger, w, h) => {
          const viewport = { width: 1000, height: 800 };
          const { rect: out } = placePopover(
            trigger,
            { width: w, height: h },
            viewport,
            { margin: 8 },
          );
          expect(out.left).toBe(8);
          expect(out.top).toBe(8);
        },
      ),
    );
  });
});

describe('facingEdgeFromPoint (used by the funnel, all four flips)', () => {
  const popover = rect(100, 100, 300, 180);
  const cases: { name: string; from: Point; expected: Edge }[] = [
    { name: 'pointer above card → top edge', from: { x: 200, y: 40 }, expected: 'top' },
    {
      name: 'pointer below card → bottom edge',
      from: { x: 200, y: 260 },
      expected: 'bottom',
    },
    {
      name: 'pointer left of card → left edge',
      from: { x: 20, y: 140 },
      expected: 'left',
    },
    {
      name: 'pointer right of card → right edge',
      from: { x: 460, y: 140 },
      expected: 'right',
    },
  ];
  for (const { name, from, expected } of cases) {
    it(name, () => {
      expect(facingEdgeFromPoint(from, popover)).toBe(expected);
    });
  }
});
