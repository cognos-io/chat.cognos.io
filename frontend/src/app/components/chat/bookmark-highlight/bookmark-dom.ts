import { type BookmarkAnchor, captureAnchor, locateAnchor } from './bookmark-anchor';

/**
 * DOM glue between a bookmark's text-quote anchor and live DOM Ranges.
 *
 * Offsets are UTF-16 indices into the container's rendered plain text
 * (`textContent`). We map a DOM point → offset with `Range.toString().length`
 * (counts exactly the text a Range covers), and offset → DOM point by walking
 * text nodes. The resulting Range is then painted with the CSS Custom Highlight
 * API — no DOM mutation, so highlights cross markdown element boundaries
 * (bold/links/list items) without invalid nesting.
 */

export function plainText(root: HTMLElement): string {
  return root.textContent ?? '';
}

/** UTF-16 offset of a (container, offset) DOM point within `root`'s text. */
function pointOffset(root: HTMLElement, container: Node, offset: number): number {
  const range = root.ownerDocument.createRange();
  range.selectNodeContents(root);
  range.setEnd(container, offset);
  return range.toString().length;
}

/** The [start,end) text offsets a Range covers within `root`. */
export function rangeToOffsets(
  root: HTMLElement,
  range: Range,
): { start: number; end: number } {
  return {
    start: pointOffset(root, range.startContainer, range.startOffset),
    end: pointOffset(root, range.endContainer, range.endOffset),
  };
}

/** Build a DOM Range spanning [start,end) text offsets within `root`. */
export function offsetsToRange(
  root: HTMLElement,
  start: number,
  end: number,
): Range | null {
  if (start < 0 || end < start) {
    return null;
  }
  const range = root.ownerDocument.createRange();
  const walker = root.ownerDocument.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let acc = 0;
  let startSet = false;
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const len = node.nodeValue?.length ?? 0;
    if (!startSet && start <= acc + len) {
      range.setStart(node, start - acc);
      startSet = true;
    }
    if (startSet && end <= acc + len) {
      range.setEnd(node, end - acc);
      return range;
    }
    acc += len;
  }
  return null;
}

/** Capture a bookmark anchor from a selection Range within `root`. */
export function anchorFromRange(
  root: HTMLElement,
  range: Range,
  context?: number,
): BookmarkAnchor | null {
  const { start, end } = rangeToOffsets(root, range);
  return captureAnchor(plainText(root), start, end, context);
}

/** Locate a bookmark anchor within `root` and return its live Range, if found. */
export function rangeForAnchor(
  root: HTMLElement,
  anchor: BookmarkAnchor,
): Range | null {
  const located = locateAnchor(plainText(root), anchor);
  if (!located) {
    return null;
  }
  return offsetsToRange(root, located.start, located.end);
}
