// Pure, DOM-free geometry for the hover-intent "safe triangle" (a.k.a. hover
// funnel) behaviour and for viewport-aware popover placement. Everything here
// is a plain function over `RectLike`/`Point` values so it is tree-shakeable
// and property-testable in isolation (no Angular, no DOM). The directive
// (`safe-triangle.directive.ts`) is the only consumer that turns live
// `DOMRect`s and pointer coordinates into these inputs.

/** A point in viewport (client) coordinates. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/**
 * A `DOMRect`-compatible rectangle. We only rely on the edge fields so callers
 * can pass a real `DOMRect` straight through.
 */
export interface RectLike {
  readonly left: number;
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
}

/** Width/height of a popover before it is placed. */
export interface Size {
  readonly width: number;
  readonly height: number;
}

/** The visible viewport, in CSS pixels. */
export interface Viewport {
  readonly width: number;
  readonly height: number;
}

/** A triangle as its three corners. */
export type Triangle = readonly [Point, Point, Point];

/** The edge of a rectangle that faces a reference point/rect. */
export type Edge = 'top' | 'bottom' | 'left' | 'right';

/** Which side of the trigger a popover is placed on. */
export type Placement = 'top' | 'bottom' | 'left' | 'right';

/** Options for {@link placePopover}. */
export interface PlacementOptions {
  /** Preferred side. The popover flips to the opposite side if it fits better. */
  readonly placement?: Placement;
  /** Distance between the trigger and the popover, in px. */
  readonly gap?: number;
  /** Minimum distance the popover must keep from every viewport edge, in px. */
  readonly margin?: number;
}

/** Result of {@link placePopover}: the final rect and the side actually used. */
export interface PlacementResult {
  readonly rect: RectLike;
  readonly placement: Placement;
}

function clamp(value: number, min: number, max: number): number {
  // When the popover is larger than the available span (max < min) we pin to
  // `min` (the near margin) rather than producing NaN/inverted output.
  if (max < min) {
    return min;
  }
  return Math.min(Math.max(value, min), max);
}

/**
 * Point-in-triangle test using the sign-of-cross-product method. Inclusive of
 * edges and vertices (a point exactly on a boundary counts as inside). Never
 * throws; a degenerate (zero-area) triangle simply reports every collinear
 * point as inside, which is harmless for the hover funnel.
 */
export function pointInTriangle(p: Point, triangle: Triangle): boolean {
  const [a, b, c] = triangle;
  const d1 = cross(p, a, b);
  const d2 = cross(p, b, c);
  const d3 = cross(p, c, a);
  const hasNeg = d1 < 0 || d2 < 0 || d3 < 0;
  const hasPos = d1 > 0 || d2 > 0 || d3 > 0;
  return !(hasNeg && hasPos);
}

function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/**
 * The edge of `to` that faces `from`, chosen as the side with the largest gap
 * between the two rects (the direction `to` is offset from `from`). Generic
 * across all four relative placements and diagonal ones: a popover
 * below-and-right of the trigger still resolves to its `top` edge because the
 * vertical gap dominates the (near-zero, overlapping) horizontal gap. When the
 * rects overlap on every axis the least-overlapping (closest) edge wins, so it
 * never throws and always returns a sensible edge.
 */
export function facingEdge(from: RectLike, to: RectLike): Edge {
  // Gap from `from` to each edge of `to`. Positive → `to` is on that side.
  const gaps: Record<Edge, number> = {
    top: to.top - from.bottom, // `to` sits below `from` → its top edge faces up
    bottom: from.top - to.bottom, // `to` sits above `from` → its bottom edge faces down
    left: to.left - from.right, // `to` sits right of `from` → its left edge faces
    right: from.left - to.right, // `to` sits left of `from` → its right edge faces
  };
  let best: Edge = 'top';
  for (const edge of ['bottom', 'left', 'right'] as Edge[]) {
    if (gaps[edge] > gaps[best]) {
      best = edge;
    }
  }
  return best;
}

/**
 * The edge of `rect` that faces `from` (a point). Used by the hover funnel,
 * whose apex is the pointer position rather than a rectangle. Equivalent to
 * {@link facingEdge} with a zero-size rect at the point.
 */
export function facingEdgeFromPoint(from: Point, rect: RectLike): Edge {
  return facingEdge({ left: from.x, top: from.y, right: from.x, bottom: from.y }, rect);
}

/** The two corner points of a rectangle's named edge. */
export function edgeCorners(rect: RectLike, edge: Edge): readonly [Point, Point] {
  switch (edge) {
    case 'top':
      return [
        { x: rect.left, y: rect.top },
        { x: rect.right, y: rect.top },
      ];
    case 'bottom':
      return [
        { x: rect.left, y: rect.bottom },
        { x: rect.right, y: rect.bottom },
      ];
    case 'left':
      return [
        { x: rect.left, y: rect.top },
        { x: rect.left, y: rect.bottom },
      ];
    case 'right':
      return [
        { x: rect.right, y: rect.top },
        { x: rect.right, y: rect.bottom },
      ];
  }
}

/**
 * The hover funnel: the triangle formed by the pointer (`apex`) and the two
 * corners of the popover edge closest to the pointer. While a close is pending,
 * a pointer that stays inside this triangle is "heading toward the popover" and
 * should keep it open. Works for any placement because the facing edge is
 * derived from the popover's live rect relative to the pointer.
 */
export function hoverFunnel(apex: Point, popover: RectLike): Triangle {
  const [c1, c2] = edgeCorners(popover, facingEdgeFromPoint(apex, popover));
  return [apex, c1, c2];
}

function opposite(placement: Placement): Placement {
  switch (placement) {
    case 'top':
      return 'bottom';
    case 'bottom':
      return 'top';
    case 'left':
      return 'right';
    case 'right':
      return 'left';
  }
}

// Free space between the trigger and the relevant viewport edge for a side.
function spaceFor(placement: Placement, trigger: RectLike, viewport: Viewport): number {
  switch (placement) {
    case 'top':
      return trigger.top;
    case 'bottom':
      return viewport.height - trigger.bottom;
    case 'left':
      return trigger.left;
    case 'right':
      return viewport.width - trigger.right;
  }
}

/** Axis-aligned rectangle overlap. Edges that merely touch do NOT intersect. */
export function rectsIntersect(a: RectLike, b: RectLike): boolean {
  return !(
    a.right <= b.left ||
    a.left >= b.right ||
    a.bottom <= b.top ||
    a.top >= b.bottom
  );
}

// Grow a rect by `by` px on every side (used to require a gap-sized clearance
// ring around the trigger).
function inflate(rect: RectLike, by: number): RectLike {
  return {
    left: rect.left - by,
    top: rect.top - by,
    right: rect.right + by,
    bottom: rect.bottom + by,
  };
}

// True when the rect sits fully inside the viewport, inset by `margin`.
function withinViewport(rect: RectLike, viewport: Viewport, margin: number): boolean {
  return (
    rect.left >= margin &&
    rect.top >= margin &&
    rect.right <= viewport.width - margin &&
    rect.bottom <= viewport.height - margin
  );
}

// Build the rect for a candidate side: the main axis sits `gap` away from the
// trigger, the cross axis aligns to the trigger's start edge, and BOTH axes are
// clamped into the viewport. Clamping the main axis can pull the card back over
// the trigger when space is tight — that overlap is what the caller rejects via
// the inflated-trigger test, which is why placement is never allowed to cover
// the trigger.
function candidateRect(
  placement: Placement,
  trigger: RectLike,
  size: Size,
  viewport: Viewport,
  gap: number,
  margin: number,
): RectLike {
  let left: number;
  let top: number;
  if (placement === 'top' || placement === 'bottom') {
    top = placement === 'top' ? trigger.top - gap - size.height : trigger.bottom + gap;
    top = clamp(top, margin, viewport.height - margin - size.height);
    left = clamp(trigger.left, margin, viewport.width - margin - size.width);
  } else {
    left = placement === 'left' ? trigger.left - gap - size.width : trigger.right + gap;
    left = clamp(left, margin, viewport.width - margin - size.width);
    top = clamp(trigger.top, margin, viewport.height - margin - size.height);
  }
  return { left, top, right: left + size.width, bottom: top + size.height };
}

/**
 * Viewport-aware placement that never covers the trigger.
 *
 * Candidate order: preferred side → its opposite → the two perpendicular sides.
 * The first candidate that fits fully inside the viewport (inset by `margin`)
 * AND keeps at least `gap` clearance from the trigger on every side wins — the
 * clearance is enforced by testing intersection against the trigger inflated by
 * `gap`, so a candidate that clamping has pulled back onto (or too close to) the
 * trigger is rejected in favour of the next side. Cross-axis sliding keeps the
 * card in view without moving it over the trigger.
 *
 * Degenerate fallback (tiny viewport where NO side has room): the side with the
 * most free space is chosen and clamped into the viewport. This is the only
 * case where the card may cover part of the trigger; clamping keeps that
 * overlap as small as the viewport allows.
 *
 * The result rect is in the same client coordinate space as the inputs, so the
 * caller can position the popover with `position: fixed; left; top`.
 */
export function placePopover(
  trigger: RectLike,
  size: Size,
  viewport: Viewport,
  options: PlacementOptions = {},
): PlacementResult {
  const preferred = options.placement ?? 'top';
  const gap = options.gap ?? 6;
  const margin = options.margin ?? 8;

  const perpendiculars: Placement[] =
    preferred === 'top' || preferred === 'bottom'
      ? ['left', 'right']
      : ['top', 'bottom'];
  const candidates: Placement[] = [preferred, opposite(preferred), ...perpendiculars];
  const forbidden = inflate(trigger, gap);

  for (const placement of candidates) {
    const rect = candidateRect(placement, trigger, size, viewport, gap, margin);
    if (withinViewport(rect, viewport, margin) && !rectsIntersect(rect, forbidden)) {
      return { placement, rect };
    }
  }

  // No side fits without covering the trigger or leaving the viewport.
  const fallback = candidates.reduce((best, placement) =>
    spaceFor(placement, trigger, viewport) > spaceFor(best, trigger, viewport)
      ? placement
      : best,
  );
  return {
    placement: fallback,
    rect: candidateRect(fallback, trigger, size, viewport, gap, margin),
  };
}

/** Convert a `DOMRect`-like value to a plain {@link RectLike}. */
export function toRectLike(rect: {
  left: number;
  top: number;
  right: number;
  bottom: number;
}): RectLike {
  return { left: rect.left, top: rect.top, right: rect.right, bottom: rect.bottom };
}
