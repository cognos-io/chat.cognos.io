// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { BookmarkHighlightService } from './bookmark-highlight.service';

// A stand-in Range — the service treats ranges opaquely (stores, flattens,
// counts, forwards to the Highlight constructor), so identity is all we need.
const range = (): Range => ({}) as Range;

describe('BookmarkHighlightService', () => {
  let service: BookmarkHighlightService;

  beforeEach(() => {
    service = new BookmarkHighlightService();
  });

  describe('without the CSS Custom Highlight API', () => {
    beforeEach(() => {
      // jsdom exposes no CSS.highlights; make the absence explicit.
      vi.stubGlobal('CSS', undefined);
    });
    afterEach(() => vi.unstubAllGlobals());

    it('is a no-op: rebuild paints nothing but ranges are still grouped', () => {
      const owner = {};
      service.register(owner, [range(), range()]);

      expect(service.rebuild()).toBe(0);
      // Grouping still works even though nothing is painted.
      expect(service.allRanges()).toHaveLength(2);
    });
  });

  describe('with the CSS Custom Highlight API', () => {
    let highlightsSet: ReturnType<typeof vi.fn>;
    let highlightsDelete: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      highlightsSet = vi.fn();
      highlightsDelete = vi.fn();
      vi.stubGlobal('CSS', {
        highlights: { set: highlightsSet, delete: highlightsDelete },
      });
      // Constructible Highlight that records how many ranges it was given.
      vi.stubGlobal(
        'Highlight',
        class {
          ranges: Range[];
          constructor(...ranges: Range[]) {
            this.ranges = ranges;
          }
        },
      );
    });
    afterEach(() => vi.unstubAllGlobals());

    it('rebuilds one Highlight from every owner and counts the ranges', () => {
      const a = {};
      const b = {};
      service.register(a, [range(), range()]);
      service.register(b, [range()]);

      // register() rebuilds on each call; the last count reflects all owners.
      expect(service.allRanges()).toHaveLength(3);
      expect(service.rebuild()).toBe(3);
      expect(highlightsSet).toHaveBeenLastCalledWith(
        'cognos-bookmark',
        expect.anything(),
      );
    });

    it('unregister drops an owner and repaints the remainder', () => {
      const a = {};
      const b = {};
      service.register(a, [range(), range()]);
      service.register(b, [range()]);

      service.unregister(a);
      expect(service.allRanges()).toHaveLength(1);
      expect(service.rebuild()).toBe(1);
    });

    it('clears the highlight when the last owner is removed', () => {
      const a = {};
      service.register(a, [range()]);
      service.unregister(a);

      expect(service.rebuild()).toBe(0);
      expect(highlightsDelete).toHaveBeenCalledWith('cognos-bookmark');
    });
  });
});
