import { TestBed } from '@angular/core/testing';

import { describe, expect, it } from 'vitest';

import { CognosSegmentedControlComponent } from './segmented-control.component';

const OPTS = [
  { value: 'a', label: 'A' },
  { value: 'b', label: 'B' },
  { value: 'cost', label: 'Cost', icon: 'chevron-down' as const },
];

describe('CognosSegmentedControlComponent', () => {
  it('marks the active segment and emits a clicked value', () => {
    const fixture = TestBed.createComponent(CognosSegmentedControlComponent);
    fixture.componentRef.setInput('options', OPTS);
    fixture.componentRef.setInput('value', 'a');
    fixture.detectChanges();

    const options = fixture.nativeElement.querySelectorAll('.cog-segmented__option');
    expect(options[0].getAttribute('aria-pressed')).toBe('true');
    expect(options[1].getAttribute('aria-pressed')).toBe('false');

    let emitted = 'unset';
    fixture.componentInstance.select.subscribe((v: string) => (emitted = v));
    options[1].click();
    expect(emitted).toBe('b');
  });

  it('re-emits when the already-active segment is clicked (bidirectional toggles)', () => {
    const fixture = TestBed.createComponent(CognosSegmentedControlComponent);
    fixture.componentRef.setInput('options', OPTS);
    fixture.componentRef.setInput('value', 'a');
    fixture.detectChanges();

    let count = 0;
    let last = '';
    fixture.componentInstance.select.subscribe((v: string) => {
      count++;
      last = v;
    });
    const active = fixture.nativeElement.querySelectorAll('.cog-segmented__option')[0];
    active.click();
    expect(count).toBe(1);
    expect(last).toBe('a');
  });

  it('renders and rotates a trailing icon when requested', () => {
    const fixture = TestBed.createComponent(CognosSegmentedControlComponent);
    fixture.componentRef.setInput('options', [
      { value: 'cost', label: 'Cost', icon: 'chevron-down', iconRotated: true },
    ]);
    fixture.componentRef.setInput('value', 'cost');
    fixture.detectChanges();

    const icon = fixture.nativeElement.querySelector('.cog-segmented__icon');
    expect(icon).not.toBeNull();
    expect(icon.classList.contains('cog-segmented__icon--rotated')).toBe(true);
  });
});
