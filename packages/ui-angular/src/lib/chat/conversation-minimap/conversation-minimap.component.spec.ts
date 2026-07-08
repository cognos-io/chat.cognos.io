import { TestBed } from '@angular/core/testing';

import { describe, expect, it } from 'vitest';

import {
  CognosConversationMinimapComponent,
  type MinimapTick,
} from './conversation-minimap.component';

const TICKS: MinimapTick[] = [
  { id: 'a', preview: 'First question', ariaLabel: 'Jump to: First question' },
  { id: 'b', preview: 'Second question', ariaLabel: 'Jump to: Second question' },
  { id: 'c', preview: 'Third question', ariaLabel: 'Jump to: Third question' },
];

function render(inputs: Record<string, unknown>) {
  const fixture = TestBed.createComponent(CognosConversationMinimapComponent);
  for (const [key, value] of Object.entries(inputs)) {
    fixture.componentRef.setInput(key, value);
  }
  fixture.detectChanges();
  return fixture;
}

describe('CognosConversationMinimapComponent', () => {
  it('renders the nav and a tick per entry with the pinned testids', () => {
    const fixture = render({ ticks: TICKS, activeId: 'b', navLabel: 'Navigator' });
    const root = fixture.nativeElement as HTMLElement;

    expect(root.querySelector('[data-testid="conversation-minimap"]')).toBeTruthy();

    const ticks = root.querySelectorAll('[data-testid="minimap-tick"]');
    expect(ticks.length).toBe(3);

    // The preview tooltip is hover-intent driven, so it isn't in the DOM until a
    // tick is hovered/focused.
    expect(root.querySelectorAll('[data-testid="minimap-preview"]').length).toBe(0);

    // The active tick carries the active modifier class.
    expect(ticks[1].classList.contains('minimap__tick--active')).toBe(true);
    expect(ticks[0].classList.contains('minimap__tick--active')).toBe(false);
  });

  it('opens the preview tooltip for a tick on focus with its testid + text', () => {
    const fixture = render({ ticks: TICKS, activeId: null, navLabel: 'Navigator' });
    const root = fixture.nativeElement as HTMLElement;

    const tick = root.querySelectorAll('[data-testid="minimap-tick"]')[0];
    tick.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    fixture.detectChanges();

    // Preview renders as a descendant of the tick button (so e2e can resolve
    // getByTestId('minimap-tick').first().getByTestId('minimap-preview')).
    const preview = tick.querySelector('[data-testid="minimap-preview"]');
    expect(preview).toBeTruthy();
    expect(preview?.getAttribute('role')).toBe('tooltip');
    expect(preview?.textContent?.trim()).toBe('First question');
  });

  it('opens the preview tooltip for a tick on mouse hover', () => {
    const fixture = render({ ticks: TICKS, activeId: null, navLabel: 'Navigator' });
    const root = fixture.nativeElement as HTMLElement;

    const tick = root.querySelectorAll('[data-testid="minimap-tick"]')[0];
    tick.dispatchEvent(
      new PointerEvent('pointerenter', { bubbles: true, pointerType: 'mouse' }),
    );
    fixture.detectChanges();

    const preview = tick.querySelector('[data-testid="minimap-preview"]');
    expect(preview).toBeTruthy();
    expect(preview?.textContent?.trim()).toBe('First question');
  });

  it('uses the per-tick aria-label and the nav label', () => {
    const fixture = render({ ticks: TICKS, activeId: null, navLabel: 'Navigator' });
    const root = fixture.nativeElement as HTMLElement;

    const nav = root.querySelector('[data-testid="conversation-minimap"]');
    expect(nav?.getAttribute('aria-label')).toBe('Navigator');

    const ticks = root.querySelectorAll('[data-testid="minimap-tick"]');
    expect(ticks[0].getAttribute('aria-label')).toBe('Jump to: First question');
    expect(ticks[0].getAttribute('title')).toBe('First question');
  });

  it('emits jump with the tick id when a tick is clicked', () => {
    const fixture = render({ ticks: TICKS, activeId: null, navLabel: 'Navigator' });
    let emitted = '';
    fixture.componentInstance.jump.subscribe((id: string) => (emitted = id));

    const ticks = fixture.nativeElement.querySelectorAll(
      '[data-testid="minimap-tick"]',
    );
    (ticks[2] as HTMLButtonElement).click();

    expect(emitted).toBe('c');
  });

  it('renders nothing when there is one or fewer ticks', () => {
    const fixture = render({
      ticks: [TICKS[0]],
      activeId: null,
      navLabel: 'Navigator',
    });
    expect(
      fixture.nativeElement.querySelector('[data-testid="conversation-minimap"]'),
    ).toBeNull();
  });
});
