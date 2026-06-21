import { TestBed } from '@angular/core/testing';

import { describe, expect, it } from 'vitest';

import { CognosIconButtonComponent } from './icon-button.component';

describe('CognosIconButtonComponent', () => {
  function render(inputs: Record<string, unknown> = {}) {
    const fixture = TestBed.createComponent(CognosIconButtonComponent);
    for (const [key, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(key, value);
    }
    fixture.detectChanges();
    return fixture;
  }

  it('composes the size class and skips the selected modifier by default', () => {
    const fixture = render({ size: 'lg' });
    const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;

    expect(button.className).toContain('cog-icon-button--lg');
    expect(button.className).not.toContain('cog-icon-button--selected');
  });

  it('adds the selected class when selected is true', () => {
    const fixture = render({ selected: true });
    const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;

    expect(button.className).toContain('cog-icon-button--selected');
  });

  it('follows the selected state for the icon tone by default', () => {
    const fixture = render({ selected: true });
    const svg = fixture.nativeElement.querySelector('svg') as SVGElement;
    expect(svg.getAttribute('class')).toContain('cog-icon--tone-selected');
  });

  it('honours an explicit tone over the selected state', () => {
    const fixture = render({ selected: true, tone: 'success' });
    const svg = fixture.nativeElement.querySelector('svg') as SVGElement;
    expect(svg.getAttribute('class')).toContain('cog-icon--tone-success');
  });

  it('uses the title for aria-label and title, and clears them when blank', () => {
    const fixture = render({ title: 'Add' });
    let button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(button.getAttribute('aria-label')).toBe('Add');
    expect(button.getAttribute('title')).toBe('Add');

    fixture.componentRef.setInput('title', '');
    fixture.detectChanges();
    button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;
    expect(button.getAttribute('aria-label')).toBeNull();
    expect(button.getAttribute('title')).toBeNull();
  });
});
