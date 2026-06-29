import { TestBed } from '@angular/core/testing';

import { describe, expect, it } from 'vitest';

import { CognosPageHeaderComponent } from './page-header.component';

describe('CognosPageHeaderComponent', () => {
  it('renders the title and subtitle', () => {
    const fixture = TestBed.createComponent(CognosPageHeaderComponent);
    fixture.componentRef.setInput('title', 'Security');
    fixture.componentRef.setInput('subtitle', 'Protect your account.');
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('.cog-page-header__title')?.textContent,
    ).toContain('Security');
    expect(
      fixture.nativeElement.querySelector('.cog-page-header__subtitle')?.textContent,
    ).toContain('Protect your account.');
  });

  it('omits breadcrumbs when none are provided', () => {
    const fixture = TestBed.createComponent(CognosPageHeaderComponent);
    fixture.componentRef.setInput('title', 'Projects');
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('cog-breadcrumbs')).toBeNull();
  });
});
