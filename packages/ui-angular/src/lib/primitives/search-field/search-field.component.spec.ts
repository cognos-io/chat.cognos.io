import { TestBed } from '@angular/core/testing';

import { describe, expect, it } from 'vitest';

import { CognosSearchFieldComponent } from './search-field.component';

describe('CognosSearchFieldComponent', () => {
  it('emits valueChange on input', () => {
    const fixture = TestBed.createComponent(CognosSearchFieldComponent);
    fixture.componentRef.setInput('placeholder', 'Search files');
    fixture.detectChanges();

    let emitted = '';
    fixture.componentInstance.valueChange.subscribe((v: string) => (emitted = v));

    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    input.value = 'cognos';
    input.dispatchEvent(new Event('input'));

    expect(emitted).toBe('cognos');
    expect(input.getAttribute('type')).toBe('search');
  });

  it('falls back to the placeholder for the aria-label', () => {
    const fixture = TestBed.createComponent(CognosSearchFieldComponent);
    fixture.componentRef.setInput('placeholder', 'Search files');
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    expect(input.getAttribute('aria-label')).toBe('Search files');
  });
});
