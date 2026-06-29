import { TestBed } from '@angular/core/testing';

import { describe, expect, it } from 'vitest';

import { CognosCardComponent } from './card.component';

describe('CognosCardComponent', () => {
  it('renders heading and subtitle when provided', () => {
    const fixture = TestBed.createComponent(CognosCardComponent);
    fixture.componentRef.setInput('heading', 'Password');
    fixture.componentRef.setInput('subtitle', 'Only signs you in.');
    fixture.detectChanges();

    const title = fixture.nativeElement.querySelector('.cog-card__title');
    const subtitle = fixture.nativeElement.querySelector('.cog-card__subtitle');
    expect(title?.textContent).toContain('Password');
    expect(subtitle?.textContent).toContain('Only signs you in.');
  });

  it('omits the head when there is no heading or subtitle', () => {
    const fixture = TestBed.createComponent(CognosCardComponent);
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.cog-card__head')).toBeNull();
  });

  it('applies the danger tone to the title', () => {
    const fixture = TestBed.createComponent(CognosCardComponent);
    fixture.componentRef.setInput('heading', 'Danger zone');
    fixture.componentRef.setInput('tone', 'danger');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('.cog-card--danger')).not.toBeNull();
  });
});
