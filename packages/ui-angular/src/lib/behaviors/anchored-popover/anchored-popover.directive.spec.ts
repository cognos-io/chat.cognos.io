import { Component, signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { beforeEach, describe, expect, it } from 'vitest';

import { Placement, placePopover } from '../hover-intent/hover-intent-geometry';
import { AnchoredPopoverDirective } from './anchored-popover.directive';

const POP_SIZE = { width: 200, height: 120 };
const VIEWPORT = { width: 1000, height: 800 };

@Component({
  selector: 'cog-anchored-popover-host',
  standalone: true,
  imports: [AnchoredPopoverDirective],
  template: `
    <div class="wrap">
      <button type="button">trigger</button>
      @if (open()) {
        <div
          class="pop"
          cogAnchoredPopover
          [cogAnchoredPopoverPlacement]="placement()"
        ></div>
      }
    </div>
  `,
})
class HostComponent {
  readonly open = signal(false);
  readonly placement = signal<Placement>('bottom');
}

describe('AnchoredPopoverDirective', () => {
  let fixture: ComponentFixture<HostComponent>;

  beforeEach(() => {
    TestBed.configureTestingModule({ imports: [HostComponent] });
    fixture = TestBed.createComponent(HostComponent);

    Object.defineProperty(document.documentElement, 'clientWidth', {
      value: VIEWPORT.width,
      configurable: true,
    });
    Object.defineProperty(document.documentElement, 'clientHeight', {
      value: VIEWPORT.height,
      configurable: true,
    });
  });

  function wrap(): HTMLElement {
    return fixture.nativeElement.querySelector('.wrap');
  }

  // Open the popover, feed the anchor/popover deterministic geometry (jsdom
  // reports zeros otherwise), then dispatch a scroll to run placement.
  function openAt(triggerRect: DOMRect): HTMLElement {
    fixture.componentInstance.open.set(true);
    fixture.detectChanges();

    wrap().getBoundingClientRect = () => triggerRect;
    const pop = fixture.debugElement.query(By.css('.pop')).nativeElement as HTMLElement;
    Object.defineProperty(pop, 'offsetWidth', {
      value: POP_SIZE.width,
      configurable: true,
    });
    Object.defineProperty(pop, 'offsetHeight', {
      value: POP_SIZE.height,
      configurable: true,
    });

    document.dispatchEvent(new Event('scroll'));
    return pop;
  }

  function rectAt(left: number, top: number): DOMRect {
    return {
      left,
      top,
      right: left + 30,
      bottom: top + 30,
      width: 30,
      height: 30,
      x: left,
      y: top,
      toJSON: () => ({}),
    } as DOMRect;
  }

  it('positions the popover fixed, left-aligned below the trigger when it fits', () => {
    const trigger = rectAt(100, 100);
    const pop = openAt(trigger);

    const expected = placePopover(trigger, POP_SIZE, VIEWPORT, {
      placement: 'bottom',
      gap: 4,
      margin: 8,
    });

    expect(pop.style.position).toBe('fixed');
    expect(pop.style.left).toBe(`${expected.rect.left}px`);
    expect(pop.style.top).toBe(`${expected.rect.top}px`);
    // Below the trigger: the menu opens downward when there's room.
    expect(expected.rect.top).toBeGreaterThan(trigger.bottom);
  });

  it('flips above the trigger when there is no room below (the composer case)', () => {
    // Trigger sits near the bottom edge, so a downward menu would overflow.
    const trigger = rectAt(100, VIEWPORT.height - 40);
    const pop = openAt(trigger);

    const expected = placePopover(trigger, POP_SIZE, VIEWPORT, {
      placement: 'bottom',
      gap: 4,
      margin: 8,
    });

    expect(pop.style.top).toBe(`${expected.rect.top}px`);
    // Flipped upward: the menu now sits above the trigger, clear of the edge.
    expect(expected.rect.bottom).toBeLessThanOrEqual(trigger.top);
  });
});
