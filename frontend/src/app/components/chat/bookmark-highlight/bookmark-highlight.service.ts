import { Injectable } from '@angular/core';

/**
 * The CSS Custom Highlight API name our stylesheet paints (see the
 * `::highlight(cognos-bookmark)` rule in styles.scss).
 */
const HIGHLIGHT_NAME = 'cognos-bookmark';

/**
 * BookmarkHighlightService is a registry of live DOM Ranges painted with the
 * CSS Custom Highlight API. Each owner (a rendered-markdown component instance)
 * registers the Ranges for its bookmarks; after every change we rebuild a single
 * `Highlight` from every owner's Ranges and hand it to `CSS.highlights`. Painting
 * this way mutates no DOM, so a highlight can cross markdown element boundaries
 * (bold / links / list items) without invalid nesting.
 *
 * The API is progressively enhanced: where `CSS.highlights` is unavailable
 * (older browsers, jsdom) every method is a graceful no-op — bookmarks still
 * exist and jump works, they just aren't painted.
 */
@Injectable({ providedIn: 'root' })
export class BookmarkHighlightService {
  private readonly _byOwner = new Map<object, Range[]>();

  /** register replaces `owner`'s ranges and repaints. */
  register(owner: object, ranges: Range[]): void {
    this._byOwner.set(owner, ranges);
    this.rebuild();
  }

  /** unregister drops `owner`'s ranges and repaints. */
  unregister(owner: object): void {
    if (this._byOwner.delete(owner)) {
      this.rebuild();
    }
  }

  /** allRanges flattens every owner's ranges (order is not significant). */
  allRanges(): Range[] {
    return [...this._byOwner.values()].flat();
  }

  /**
   * rebuild collapses every owner's ranges into one Highlight and registers it
   * under our custom-highlight name. Returns the painted range count (0 when the
   * API is unavailable) so tests can assert the rebuild without a real browser.
   */
  rebuild(): number {
    if (!this.supported()) {
      return 0;
    }
    const ranges = this.allRanges();
    // The maplike set/delete aren't in every lib.dom version's HighlightRegistry
    // interface (only forEach is declared), so reach them through a minimal cast.
    const registry = CSS.highlights as unknown as HighlightRegistryLike;
    if (ranges.length === 0) {
      registry.delete(HIGHLIGHT_NAME);
      return 0;
    }
    registry.set(HIGHLIGHT_NAME, new Highlight(...ranges));
    return ranges.length;
  }

  // supported feature-detects the CSS Custom Highlight API.
  private supported(): boolean {
    return (
      typeof CSS !== 'undefined' && !!CSS.highlights && typeof Highlight !== 'undefined'
    );
  }
}

// Minimal maplike shape of `CSS.highlights` we depend on (lib.dom's
// HighlightRegistry interface doesn't expose set/delete across TS versions).
interface HighlightRegistryLike {
  set(name: string, highlight: Highlight): void;
  delete(name: string): void;
}
