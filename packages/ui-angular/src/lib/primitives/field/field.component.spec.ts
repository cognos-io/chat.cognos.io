import { TestBed } from '@angular/core/testing';

import { describe, expect, it } from 'vitest';

import { CognosFieldComponent } from './field.component';

describe('CognosFieldComponent', () => {
  it('shows the label and hint', () => {
    const fixture = TestBed.createComponent(CognosFieldComponent);
    fixture.componentRef.setInput('label', 'Email');
    fixture.componentRef.setInput('hint', 'Work address.');
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('.cog-field__label')?.textContent,
    ).toContain('Email');
    expect(
      fixture.nativeElement.querySelector('.cog-field__hint')?.textContent,
    ).toContain('Work address.');
    expect(fixture.nativeElement.querySelector('.cog-field__error')).toBeNull();
  });

  it('prefers the error over the hint', () => {
    const fixture = TestBed.createComponent(CognosFieldComponent);
    fixture.componentRef.setInput('hint', 'Work address.');
    fixture.componentRef.setInput('error', 'Required.');
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('.cog-field__error')?.textContent,
    ).toContain('Required.');
    expect(fixture.nativeElement.querySelector('.cog-field__hint')).toBeNull();
  });
});
