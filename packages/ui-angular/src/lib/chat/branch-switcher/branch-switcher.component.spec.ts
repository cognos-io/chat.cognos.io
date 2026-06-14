import { TestBed } from '@angular/core/testing';

import { describe, expect, it } from 'vitest';

import { CognosBranchSwitcherComponent } from './branch-switcher.component';

describe('CognosBranchSwitcherComponent', () => {
  function render(inputs: Record<string, unknown>) {
    const fixture = TestBed.createComponent(CognosBranchSwitcherComponent);
    for (const [key, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(key, value);
    }
    fixture.detectChanges();
    return fixture;
  }

  const buttons = (fixture: ReturnType<typeof render>) =>
    Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[];

  it('renders the active position out of the total', () => {
    const fixture = render({ index: 2, count: 3 });
    const label = fixture.nativeElement.querySelector(
      '.cog-branch-switcher__label',
    ) as HTMLElement;
    expect(label.textContent?.trim()).toBe('2 / 3');
  });

  it('disables previous at the first branch and next at the last', () => {
    const first = buttons(render({ index: 1, count: 3 }));
    expect(first[0].disabled).toBe(true);
    expect(first[1].disabled).toBe(false);

    const last = buttons(render({ index: 3, count: 3 }));
    expect(last[0].disabled).toBe(false);
    expect(last[1].disabled).toBe(true);
  });

  it('emits previous and next when the controls are clicked', () => {
    const fixture = render({ index: 2, count: 3 });
    const events: string[] = [];
    fixture.componentInstance.previous.subscribe(() => events.push('previous'));
    fixture.componentInstance.next.subscribe(() => events.push('next'));

    const [prev, next] = buttons(fixture);
    prev.click();
    next.click();

    expect(events).toEqual(['previous', 'next']);
  });
});
