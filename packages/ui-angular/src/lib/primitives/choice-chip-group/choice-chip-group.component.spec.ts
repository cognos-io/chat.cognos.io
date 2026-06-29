import { TestBed } from '@angular/core/testing';

import { describe, expect, it } from 'vitest';

import { CognosChoiceChipGroupComponent } from './choice-chip-group.component';

const OPTS = [
  { value: 'a', label: 'A' },
  { value: 'b', label: 'B' },
];

describe('CognosChoiceChipGroupComponent', () => {
  it('marks the active chip and emits a clicked value', () => {
    const fixture = TestBed.createComponent(CognosChoiceChipGroupComponent);
    fixture.componentRef.setInput('options', OPTS);
    fixture.componentRef.setInput('value', 'a');
    fixture.detectChanges();

    const chips = fixture.nativeElement.querySelectorAll('.cog-chip');
    expect(chips[0].getAttribute('aria-pressed')).toBe('true');

    let emitted: string | null = 'unset';
    fixture.componentInstance.valueChange.subscribe(
      (v: string | null) => (emitted = v),
    );
    chips[1].click();
    expect(emitted).toBe('b');
  });

  it('clears the selection when allowDeselect and the active chip is clicked', () => {
    const fixture = TestBed.createComponent(CognosChoiceChipGroupComponent);
    fixture.componentRef.setInput('options', OPTS);
    fixture.componentRef.setInput('value', 'a');
    fixture.componentRef.setInput('allowDeselect', true);
    fixture.detectChanges();

    let emitted: string | null = 'unset';
    fixture.componentInstance.valueChange.subscribe(
      (v: string | null) => (emitted = v),
    );
    fixture.nativeElement.querySelectorAll('.cog-chip')[0].click();
    expect(emitted).toBeNull();
  });
});
