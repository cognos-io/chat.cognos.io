import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { FormControl, ReactiveFormsModule } from '@angular/forms';

import { describe, expect, it } from 'vitest';

import { CognosTextFieldComponent } from './text-field.component';

@Component({
  standalone: true,
  imports: [CognosTextFieldComponent, ReactiveFormsModule],
  template: `<cog-text-field [formControl]="control" />`,
})
class FormHostComponent {
  readonly control = new FormControl('');
}

describe('CognosTextFieldComponent', () => {
  it('works as a reactive form control (writeValue + onChange + disabled)', () => {
    const fixture = TestBed.createComponent(FormHostComponent);
    fixture.detectChanges();
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;

    // form -> view
    fixture.componentInstance.control.setValue('seed');
    fixture.detectChanges();
    expect(input.value).toBe('seed');

    // view -> form
    input.value = 'typed';
    input.dispatchEvent(new Event('input'));
    expect(fixture.componentInstance.control.value).toBe('typed');

    // disabled state from the form
    fixture.componentInstance.control.disable();
    fixture.detectChanges();
    expect(input.disabled).toBe(true);
  });

  it('updates the value model with the typed value', () => {
    const fixture = TestBed.createComponent(CognosTextFieldComponent);
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    input.value = 'hello';
    input.dispatchEvent(new Event('input'));

    expect(fixture.componentInstance.value()).toBe('hello');
  });

  it('applies the disabled modifier and disables the input', () => {
    const fixture = TestBed.createComponent(CognosTextFieldComponent);
    fixture.componentRef.setInput('disabled', true);
    fixture.detectChanges();

    const label = fixture.nativeElement.querySelector('label') as HTMLLabelElement;
    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;

    expect(label.className).toContain('cog-text-field--disabled');
    expect(input.disabled).toBe(true);
  });

  it('falls back to the placeholder for aria-label when no aria-label is provided', () => {
    const fixture = TestBed.createComponent(CognosTextFieldComponent);
    fixture.componentRef.setInput('placeholder', 'Search…');
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    expect(input.getAttribute('aria-label')).toBe('Search…');
  });

  it('prefers the explicit aria-label over the placeholder', () => {
    const fixture = TestBed.createComponent(CognosTextFieldComponent);
    fixture.componentRef.setInput('placeholder', 'Search…');
    fixture.componentRef.setInput('ariaLabel', 'Find messages');
    fixture.detectChanges();

    const input = fixture.nativeElement.querySelector('input') as HTMLInputElement;
    expect(input.getAttribute('aria-label')).toBe('Find messages');
  });
});
