import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  HoverIntentPopoverDirective,
  SafeTriangleDirective,
} from './safe-triangle.directive';

// A card positioned below-and-right of the trigger. The facing edge is the top
// edge, so the funnel apex→(top-left, top-right) opens downward.
const CARD_RECT = {
  left: 120,
  top: 140,
  right: 320,
  bottom: 240,
  width: 200,
  height: 100,
};

@Component({
  selector: 'cog-safe-triangle-host',
  standalone: true,
  imports: [SafeTriangleDirective, HoverIntentPopoverDirective],
  template: `
    <div
      cogHoverIntent
      #hi="cogHoverIntent"
      [cogHoverIntentGraceMs]="grace()"
      [cogHoverIntentAutoPlace]="autoPlace()"
    >
      <button type="button">trigger</button>
      @if (hi.opened()) {
        <div cogHoverIntentPopover class="card">
          <a href="#">Open source</a>
        </div>
      }
    </div>
  `,
})
class HostComponent {
  readonly grace = signal(500);
  readonly autoPlace = signal(false);
}

function fire(
  target: EventTarget,
  type: string,
  props: Record<string, unknown> = {},
): void {
  const event = new Event(type, { bubbles: true, cancelable: true });
  Object.assign(event, props);
  target.dispatchEvent(event);
}

describe('SafeTriangleDirective', () => {
  let fixture: ComponentFixture<HostComponent>;
  let host: HTMLElement;

  const trigger = (): HTMLElement => host.querySelector('button') as HTMLElement;
  const wrapper = (): HTMLElement =>
    host.querySelector('[cogHoverIntent]') as HTMLElement;
  const card = (): HTMLElement | null => host.querySelector('.card');
  const opened = (): boolean => !!card();

  function stubCardRect(): void {
    const el = card();
    if (el) {
      el.getBoundingClientRect = () =>
        ({
          ...CARD_RECT,
          x: CARD_RECT.left,
          y: CARD_RECT.top,
          toJSON: () => ({}),
        }) as DOMRect;
    }
  }

  beforeEach(() => {
    vi.useFakeTimers();
    TestBed.configureTestingModule({ imports: [HostComponent] });
    fixture = TestBed.createComponent(HostComponent);
    host = fixture.nativeElement as HTMLElement;
    fixture.detectChanges();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function openByHover(): void {
    fire(trigger(), 'pointerenter', {
      pointerType: 'mouse',
      clientX: 100,
      clientY: 100,
    });
    fixture.detectChanges();
    stubCardRect();
  }

  it('opens on mouse pointerenter and stays closed for touch', () => {
    fire(trigger(), 'pointerenter', {
      pointerType: 'touch',
      clientX: 100,
      clientY: 100,
    });
    fixture.detectChanges();
    expect(opened()).toBe(false);

    fire(trigger(), 'pointerenter', {
      pointerType: 'mouse',
      clientX: 100,
      clientY: 100,
    });
    fixture.detectChanges();
    expect(opened()).toBe(true);
  });

  it('toggles on click (touch tap path)', () => {
    fire(trigger(), 'click');
    fixture.detectChanges();
    expect(opened()).toBe(true);
    fire(trigger(), 'click');
    fixture.detectChanges();
    expect(opened()).toBe(false);
  });

  it('keeps open while the pointer moves toward the card, then closes on grace timeout', () => {
    openByHover();
    // Leave the trigger heading toward the card.
    fire(wrapper(), 'pointerleave', {
      pointerType: 'mouse',
      clientX: 100,
      clientY: 100,
    });
    // A move inside the funnel just before grace expires keeps it alive.
    vi.advanceTimersByTime(400);
    fire(document, 'pointermove', { clientX: 150, clientY: 130 });
    fixture.detectChanges();
    expect(opened()).toBe(true);
    vi.advanceTimersByTime(400); // 400 < grace(500) since the timer reset on move
    fixture.detectChanges();
    expect(opened()).toBe(true);
    // No further moves → the grace timer finally fires.
    vi.advanceTimersByTime(500);
    fixture.detectChanges();
    expect(opened()).toBe(false);
  });

  it('reaching the card cancels the pending close', () => {
    openByHover();
    fire(wrapper(), 'pointerleave', {
      pointerType: 'mouse',
      clientX: 100,
      clientY: 100,
    });
    fire(card() as HTMLElement, 'pointerenter', {
      pointerType: 'mouse',
      clientX: 200,
      clientY: 180,
    });
    vi.advanceTimersByTime(2000);
    fixture.detectChanges();
    expect(opened()).toBe(true);
  });

  it('closes immediately when the pointer leaves outside the funnel', () => {
    openByHover();
    fire(wrapper(), 'pointerleave', {
      pointerType: 'mouse',
      clientX: 100,
      clientY: 100,
    });
    // Perpendicular move (to the left, away from the card) → outside the funnel.
    fire(document, 'pointermove', { clientX: 10, clientY: 110 });
    fixture.detectChanges();
    expect(opened()).toBe(false); // no timer wait needed
  });

  it('Escape closes immediately', () => {
    openByHover();
    fire(wrapper(), 'keydown', { key: 'Escape' });
    fixture.detectChanges();
    expect(opened()).toBe(false);
  });

  it('scroll closes immediately', () => {
    openByHover();
    fire(document, 'scroll', {});
    fixture.detectChanges();
    expect(opened()).toBe(false);
  });

  it('removes document listeners on destroy', () => {
    const remove = vi.spyOn(document, 'removeEventListener');
    openByHover();
    fire(wrapper(), 'pointerleave', {
      pointerType: 'mouse',
      clientX: 100,
      clientY: 100,
    });
    fixture.destroy();
    const removed = remove.mock.calls.map((c) => c[0]);
    expect(removed).toContain('pointermove');
    expect(removed).toContain('scroll');
  });

  it('positions the popover fixed and records the placement when autoPlace is on', () => {
    fixture.componentInstance.autoPlace.set(true);
    fixture.detectChanges();
    openByHover();
    const el = card() as HTMLElement;
    expect(el.style.position).toBe('fixed');
    expect(el.style.left).toMatch(/px$/);
    expect(el.style.top).toMatch(/px$/);
  });
});
