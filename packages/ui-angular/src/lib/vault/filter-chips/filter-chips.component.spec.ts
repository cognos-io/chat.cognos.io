import { TestBed } from '@angular/core/testing';

import { describe, expect, it } from 'vitest';

import type { CognosVaultFilter } from '../vault.types';
import { CognosFilterChipsComponent } from './filter-chips.component';

describe('CognosFilterChipsComponent', () => {
  function render() {
    const fixture = TestBed.createComponent(CognosFilterChipsComponent);
    fixture.detectChanges();
    return fixture;
  }

  it('renders the built-in English labels by default', () => {
    const fixture = render();
    const labels = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>(
        '.cog-filter-chips__chip',
      ),
    ).map((chip) => chip.textContent?.trim());

    expect(labels).toEqual(['All', 'Documents', 'Images', 'Sheets', 'Audio']);
  });

  it('renders translated labels passed via the options input', () => {
    const fixture = render();
    fixture.componentRef.setInput('options', [
      { value: 'all', label: 'Tous' },
      { value: 'doc', label: 'Documents' },
    ]);
    fixture.detectChanges();

    const labels = Array.from(
      (fixture.nativeElement as HTMLElement).querySelectorAll<HTMLButtonElement>(
        '.cog-filter-chips__chip',
      ),
    ).map((chip) => chip.textContent?.trim());

    expect(labels).toEqual(['Tous', 'Documents']);
  });

  it('emits the selected filter value on click', () => {
    const fixture = render();
    const emitted: CognosVaultFilter[] = [];
    fixture.componentInstance.change.subscribe((value) => emitted.push(value));

    const chips = (
      fixture.nativeElement as HTMLElement
    ).querySelectorAll<HTMLButtonElement>('.cog-filter-chips__chip');
    chips[2].click(); // "Images"

    expect(emitted).toEqual(['image']);
  });
});
