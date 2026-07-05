import { DOCUMENT } from '@angular/common';
import {
  DestroyRef,
  Directive,
  ElementRef,
  Renderer2,
  afterNextRender,
  inject,
  input,
} from '@angular/core';

import {
  Placement,
  placePopover,
  toRectLike,
} from '../hover-intent/hover-intent-geometry';

// AnchoredPopoverDirective (`cogAnchoredPopover`) positions a click-toggled
// popover `fixed` beside its trigger, flipping and clamping so it always stays
// inside the viewport — the same `placePopover` brain the hover cards use, minus
// the hover state machine. The owner keeps control of open/close (an `@if`,
// outside-click, selection, etc.); the directive only owns placement.
//
// Why not `cogHoverIntent`: that directive opens on hover, which is wrong for a
// menu button. This is placement-only, so it composes with any open trigger.
//
// Adopt it in one attribute: put `cogAnchoredPopover` on the popover element.
// It anchors to the host's parent by default (the trigger wrapper the popover is
// nested in); pass `cogAnchoredPopoverAnchor` to anchor to a specific element.
// The host should be `position: fixed` in CSS so it never shifts layout before
// the first placement runs.
@Directive({
  selector: '[cogAnchoredPopover]',
})
export class AnchoredPopoverDirective {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly renderer = inject(Renderer2);
  private readonly doc = inject(DOCUMENT);

  /** Element to position against; defaults to the host's parent (the trigger). */
  readonly anchor = input<HTMLElement | null>(null, {
    alias: 'cogAnchoredPopoverAnchor',
  });
  /** Preferred side; flips/shifts to stay in the viewport. */
  readonly placement = input<Placement>('bottom', {
    alias: 'cogAnchoredPopoverPlacement',
  });
  /** Distance between trigger and popover, px. */
  readonly gap = input(4, { alias: 'cogAnchoredPopoverGap' });
  /** Minimum distance the popover keeps from every viewport edge, px. */
  readonly margin = input(8, { alias: 'cogAnchoredPopoverMargin' });

  private readonly reposition = (): void => this.place();

  constructor() {
    // Place once the popover has laid out (so offsetWidth/Height are real), then
    // keep it anchored while the surroundings scroll or the window resizes.
    afterNextRender(() => this.place());
    this.doc.addEventListener('scroll', this.reposition, {
      passive: true,
      capture: true,
    });
    globalThis.addEventListener?.('resize', this.reposition, { passive: true });
    inject(DestroyRef).onDestroy(() => {
      this.doc.removeEventListener('scroll', this.reposition, { capture: true });
      globalThis.removeEventListener?.('resize', this.reposition);
    });
  }

  private place(): void {
    const el = this.host.nativeElement;
    const anchor = this.anchor() ?? el.parentElement;
    if (!anchor) {
      return;
    }
    const trigger = toRectLike(anchor.getBoundingClientRect());
    const size = { width: el.offsetWidth, height: el.offsetHeight };
    const viewport = {
      width: this.doc.documentElement.clientWidth,
      height: this.doc.documentElement.clientHeight,
    };
    const { rect } = placePopover(trigger, size, viewport, {
      placement: this.placement(),
      gap: this.gap(),
      margin: this.margin(),
    });
    this.renderer.setStyle(el, 'position', 'fixed');
    this.renderer.setStyle(el, 'left', `${rect.left}px`);
    this.renderer.setStyle(el, 'top', `${rect.top}px`);
    this.renderer.setStyle(el, 'right', 'auto');
    this.renderer.setStyle(el, 'bottom', 'auto');
    this.renderer.setStyle(el, 'margin', '0');
  }
}
