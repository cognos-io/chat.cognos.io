import { TestBed } from '@angular/core/testing';

import { describe, expect, it } from 'vitest';

import { CognosCalloutComponent } from './callout.component';

describe('CognosCalloutComponent', () => {
  it('defaults to the neutral tone with no icon', () => {
    const fixture = TestBed.createComponent(CognosCalloutComponent);
    fixture.detectChanges();
    const box = fixture.nativeElement.querySelector('.cog-callout') as HTMLElement;

    expect(box.className).toContain('cog-callout--neutral');
    expect(fixture.nativeElement.querySelector('.cog-callout__icon')).toBeNull();
  });

  it('applies the configured tone class', () => {
    const fixture = TestBed.createComponent(CognosCalloutComponent);
    fixture.componentRef.setInput('tone', 'warning');
    fixture.detectChanges();
    const box = fixture.nativeElement.querySelector('.cog-callout') as HTMLElement;

    expect(box.className).toContain('cog-callout--warning');
  });

  it('renders the leading icon when one is provided', () => {
    const fixture = TestBed.createComponent(CognosCalloutComponent);
    fixture.componentRef.setInput('icon', 'key-round');
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.cog-callout__icon')).not.toBeNull();
  });
});
