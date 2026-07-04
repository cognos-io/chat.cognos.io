import { DOCUMENT } from '@angular/common';
import {
  DestroyRef,
  Directive,
  ElementRef,
  Renderer2,
  effect,
  inject,
  input,
  output,
  signal,
} from '@angular/core';

import {
  Placement,
  Point,
  Triangle,
  hoverFunnel,
  placePopover,
  pointInTriangle,
  toRectLike,
} from './hover-intent-geometry';

// SafeTriangleDirective (`cogHoverIntent`) turns any trigger + popover pair
// into a well-behaved hover popover:
//
//  1. Hover-intent "safe triangle" — when the pointer leaves the trigger while
//     the popover is open, we do NOT close immediately. Instead we start a
//     grace timer and watch pointer moves: as long as the pointer stays inside
//     the funnel (the triangle from the pointer to the two nearest corners of
//     the popover) it is heading toward the popover, so we keep it open and
//     keep the timer alive. Move outside the funnel → close now. Timer expires
//     without reaching the popover → close. Entering the popover cancels the
//     close; leaving the popover uses a plain grace delay (no funnel — simpler,
//     and moving back onto the trigger re-opens it anyway).
//  2. Viewport-aware placement — when open (and `autoPlace`), the popover is
//     positioned `fixed` on the preferred side, flipping/shifting so it always
//     stays fully inside the viewport (no horizontal overflow, no page jump).
//     The funnel always uses the popover's FINAL placed rect.
//
// Pointer-only logic: touch tap (click) toggles, keyboard focus opens/closes,
// and Escape/scroll close immediately — these bypass the funnel entirely.
//
// Adopt it in ~3 lines: put `cogHoverIntent #hi="cogHoverIntent"` on the trigger
// wrapper, gate the popover with `@if (hi.opened())`, and put
// `cogHoverIntentPopover` on the popover element (it self-registers with the
// wrapper directive through DI, so it works even inside the `@if`).
@Directive({
  selector: '[cogHoverIntent]',
  exportAs: 'cogHoverIntent',
  host: {
    '(pointerenter)': 'onTriggerEnter($event)',
    '(pointerleave)': 'onTriggerLeave($event)',
    '(focusin)': 'onFocusIn()',
    '(focusout)': 'onFocusOut($event)',
    '(click)': 'onClick($event)',
    '(keydown.escape)': 'onEscape($event)',
  },
})
export class SafeTriangleDirective {
  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly renderer = inject(Renderer2);
  private readonly doc = inject(DOCUMENT);

  /** The popover element, set by the companion `cogHoverIntentPopover`. */
  private readonly _popoverEl = signal<HTMLElement | null>(null);
  /** Grace period (ms) for the hover funnel before an off-trigger close fires. */
  readonly graceMs = input(500, { alias: 'cogHoverIntentGraceMs' });
  /** Preferred side; flips/shifts to stay in the viewport. */
  readonly placement = input<Placement>('top', { alias: 'cogHoverIntentPlacement' });
  /** Distance between trigger and popover, px. */
  readonly gap = input(6, { alias: 'cogHoverIntentGap' });
  /** Minimum distance the popover keeps from every viewport edge, px. */
  readonly margin = input(8, { alias: 'cogHoverIntentMargin' });
  /** When true (default), the directive positions the popover `fixed`. */
  readonly autoPlace = input(true, { alias: 'cogHoverIntentAutoPlace' });
  /** Disable all hover behaviour (e.g. on coarse-pointer only surfaces). */
  readonly disabled = input(false, { alias: 'cogHoverIntentDisabled' });

  private readonly _open = signal(false);
  /** Whether the popover should be shown. Read this in the template `@if`. */
  readonly opened = this._open.asReadonly();
  /** Emits on every open/close transition (for non-signal consumers). */
  readonly openedChange = output<boolean>();

  private readonly _funnel = signal<Triangle | null>(null);
  /**
   * The current hover funnel while an off-trigger close is pending, else null.
   * Exposed for story debug overlays and tests; not used by production styling.
   */
  readonly funnel = this._funnel.asReadonly();
  /** The side the popover was actually placed on (after any flip). */
  readonly placedPlacement = signal<Placement | null>(null);

  private closeTimer: ReturnType<typeof setTimeout> | null = null;
  private apex: Point | null = null;
  private readonly onMove = (event: PointerEvent): void => this.handleMove(event);
  private readonly onScroll = (): void => this.closeNow();
  private moveAttached = false;
  private scrollAttached = false;
  private popoverCleanup: (() => void) | null = null;

  constructor() {
    // Attach popover pointer listeners and place it whenever it appears while
    // open. Effect cleanup detaches the previous element's listeners.
    effect((onCleanup) => {
      const el = this._popoverEl();
      const open = this._open();
      this.detachPopover();
      if (!el || !open) {
        return;
      }
      if (this.autoPlace()) {
        this.place(el);
      }
      const enter = (): void => this.cancelClose();
      const leave = (event: PointerEvent): void => this.onPopoverLeave(event);
      el.addEventListener('pointerenter', enter, { passive: true });
      el.addEventListener('pointerleave', leave, { passive: true });
      this.popoverCleanup = () => {
        el.removeEventListener('pointerenter', enter);
        el.removeEventListener('pointerleave', leave);
      };
      onCleanup(() => this.detachPopover());
    });

    // Close on scroll while open; detach otherwise.
    effect(() => {
      if (this._open()) {
        this.attachScroll();
      } else {
        this.detachScroll();
      }
    });

    inject(DestroyRef).onDestroy(() => {
      this.clearTimer();
      this.detachMove();
      this.detachScroll();
      this.detachPopover();
    });
  }

  // --- Trigger (host) pointer/keyboard handlers --------------------------------

  protected onTriggerEnter(event: PointerEvent): void {
    if (this.disabled() || event.pointerType !== 'mouse') {
      return;
    }
    this.cancelClose();
    this.setOpen(true);
  }

  protected onTriggerLeave(event: PointerEvent): void {
    if (event.pointerType !== 'mouse' || !this._open()) {
      return;
    }
    this.apex = { x: event.clientX, y: event.clientY };
    this.beginFunnelClose();
  }

  protected onFocusIn(): void {
    if (this.disabled()) {
      return;
    }
    this.cancelClose();
    this.setOpen(true);
  }

  protected onFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget as Node | null;
    if (next && this.host.nativeElement.contains(next)) {
      return; // focus moved within the trigger/popover subtree
    }
    this.closeNow();
  }

  protected onClick(event: MouseEvent): void {
    const el = this._popoverEl();
    if (el && el.contains(event.target as Node)) {
      return; // clicks inside the popover (e.g. a link) don't toggle it
    }
    this.cancelClose();
    this.setOpen(!this._open());
  }

  protected onEscape(event: Event): void {
    if (this._open()) {
      event.stopPropagation();
      this.closeNow();
    }
  }

  // --- Popover pointer handling ------------------------------------------------

  private onPopoverLeave(event: PointerEvent): void {
    if (event.pointerType !== 'mouse' || !this._open()) {
      return;
    }
    // Plain grace delay back toward the trigger (re-entering it re-opens).
    this._funnel.set(null);
    this.detachMove();
    this.armTimer();
  }

  // --- Funnel close state machine ---------------------------------------------

  private beginFunnelClose(): void {
    const el = this._popoverEl();
    if (el && this.apex) {
      this._funnel.set(hoverFunnel(this.apex, toRectLike(el.getBoundingClientRect())));
      this.attachMove();
    } else {
      this._funnel.set(null);
    }
    this.armTimer();
  }

  private handleMove(event: PointerEvent): void {
    const el = this._popoverEl();
    if (!el || !this.apex) {
      return; // no funnel guard: the grace timer will close on its own
    }
    const cur: Point = { x: event.clientX, y: event.clientY };
    // Recompute from the PREVIOUS apex, then advance so the triangle tracks the
    // pointer's progress toward the popover.
    const triangle = hoverFunnel(this.apex, toRectLike(el.getBoundingClientRect()));
    this._funnel.set(triangle);
    if (pointInTriangle(cur, triangle)) {
      this.apex = cur;
      this.armTimer(); // still heading toward the popover → keep alive
    } else {
      this.closeNow();
    }
  }

  private armTimer(): void {
    this.clearTimer();
    this.closeTimer = setTimeout(() => this.closeNow(), this.graceMs());
  }

  private cancelClose(): void {
    this.clearTimer();
    this.detachMove();
    this._funnel.set(null);
    this.apex = null;
  }

  private closeNow(): void {
    this.cancelClose();
    this.setOpen(false);
  }

  private clearTimer(): void {
    if (this.closeTimer !== null) {
      clearTimeout(this.closeTimer);
      this.closeTimer = null;
    }
  }

  private setOpen(value: boolean): void {
    if (this._open() === value) {
      return;
    }
    this._open.set(value);
    this.openedChange.emit(value);
  }

  // --- Placement ---------------------------------------------------------------

  private place(el: HTMLElement): void {
    const trigger = toRectLike(this.host.nativeElement.getBoundingClientRect());
    const size = { width: el.offsetWidth, height: el.offsetHeight };
    const viewport = {
      width: this.doc.documentElement.clientWidth,
      height: this.doc.documentElement.clientHeight,
    };
    const { rect, placement } = placePopover(trigger, size, viewport, {
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
    this.placedPlacement.set(placement);
  }

  // --- Listener lifecycle ------------------------------------------------------

  private attachMove(): void {
    if (!this.moveAttached) {
      this.doc.addEventListener('pointermove', this.onMove, { passive: true });
      this.moveAttached = true;
    }
  }

  private detachMove(): void {
    if (this.moveAttached) {
      this.doc.removeEventListener('pointermove', this.onMove);
      this.moveAttached = false;
    }
  }

  private attachScroll(): void {
    if (!this.scrollAttached) {
      this.doc.addEventListener('scroll', this.onScroll, {
        passive: true,
        capture: true,
      });
      this.scrollAttached = true;
    }
  }

  private detachScroll(): void {
    if (this.scrollAttached) {
      this.doc.removeEventListener('scroll', this.onScroll, { capture: true });
      this.scrollAttached = false;
    }
  }

  private detachPopover(): void {
    if (this.popoverCleanup) {
      this.popoverCleanup();
      this.popoverCleanup = null;
    }
  }

  // --- Companion wiring --------------------------------------------------------

  /** Called by the companion `cogHoverIntentPopover` when it renders. */
  registerPopover(el: HTMLElement): void {
    this._popoverEl.set(el);
  }

  /** Called by the companion when it is destroyed (e.g. the `@if` closes). */
  unregisterPopover(el: HTMLElement): void {
    if (this._popoverEl() === el) {
      this._popoverEl.set(null);
    }
  }
}

// Marks the popover element of a `cogHoverIntent` pair. Place it on the element
// rendered inside the trigger's `@if (hi.opened())` block; it finds the parent
// SafeTriangleDirective through DI (works across the `@if` embedded view) and
// registers/unregisters its host element, so no template-ref plumbing is needed.
@Directive({
  selector: '[cogHoverIntentPopover]',
})
export class HoverIntentPopoverDirective {
  constructor() {
    const parent = inject(SafeTriangleDirective);
    const el = inject<ElementRef<HTMLElement>>(ElementRef).nativeElement;
    parent.registerPopover(el);
    inject(DestroyRef).onDestroy(() => parent.unregisterPopover(el));
  }
}
