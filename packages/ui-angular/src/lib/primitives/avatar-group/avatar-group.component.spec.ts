import { TestBed } from '@angular/core/testing';

import { describe, expect, it } from 'vitest';

import { CognosAvatarGroupComponent } from './avatar-group.component';

describe('CognosAvatarGroupComponent', () => {
  function render(inputs: Record<string, unknown> = {}) {
    const fixture = TestBed.createComponent(CognosAvatarGroupComponent);
    for (const [key, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(key, value);
    }
    fixture.detectChanges();
    return fixture;
  }

  it('renders one avatar per item', () => {
    const fixture = render({
      items: [{ name: 'Ada' }, { name: 'Grace' }, { group: true }],
    });

    const avatars = fixture.nativeElement.querySelectorAll('cog-avatar');
    expect(avatars).toHaveLength(3);
  });

  it('derives the overlap from the configured size', () => {
    const fixture = render({ items: [{ name: 'Ada' }], size: 40 });
    const group = fixture.nativeElement.querySelector(
      '.cog-avatar-group',
    ) as HTMLElement;

    expect(group.style.getPropertyValue('--_avatar-overlap')).toBe('11px');
  });

  it('falls back to size 32 for unsupported sizes', () => {
    const fixture = render({ items: [{ name: 'Ada' }], size: '9001' });
    const group = fixture.nativeElement.querySelector(
      '.cog-avatar-group',
    ) as HTMLElement;

    expect(group.style.getPropertyValue('--_avatar-overlap')).toBe('9px');
  });
});
