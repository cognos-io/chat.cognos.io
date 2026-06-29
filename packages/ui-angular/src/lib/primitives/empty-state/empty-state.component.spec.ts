import { TestBed } from '@angular/core/testing';

import { describe, expect, it } from 'vitest';

import { CognosEmptyStateComponent } from './empty-state.component';

describe('CognosEmptyStateComponent', () => {
  it('renders the message and omits the icon/title when unset', () => {
    const fixture = TestBed.createComponent(CognosEmptyStateComponent);
    fixture.componentRef.setInput('message', 'No files yet.');
    fixture.detectChanges();

    expect(
      fixture.nativeElement.querySelector('.cog-empty-state__message')?.textContent,
    ).toContain('No files yet.');
    expect(fixture.nativeElement.querySelector('.cog-empty-state__title')).toBeNull();
    expect(fixture.nativeElement.querySelector('cog-icon')).toBeNull();
  });

  it('applies the role when provided', () => {
    const fixture = TestBed.createComponent(CognosEmptyStateComponent);
    fixture.componentRef.setInput('message', 'No results');
    fixture.componentRef.setInput('role', 'status');
    fixture.detectChanges();
    const el = fixture.nativeElement.querySelector('.cog-empty-state');
    expect(el?.getAttribute('role')).toBe('status');
  });
});
