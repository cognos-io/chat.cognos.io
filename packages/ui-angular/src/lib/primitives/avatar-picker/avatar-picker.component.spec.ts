import { TestBed } from '@angular/core/testing';

import { describe, expect, it } from 'vitest';

import { CognosAvatarPickerComponent } from './avatar-picker.component';

describe('CognosAvatarPickerComponent', () => {
  it('emits the picked icon and colour', () => {
    const fixture = TestBed.createComponent(CognosAvatarPickerComponent);
    fixture.componentRef.setInput('icons', ['sparkles', 'rocket']);
    fixture.componentRef.setInput('colors', ['green', 'blue']);
    fixture.componentRef.setInput('selectedIcon', 'sparkles');
    fixture.componentRef.setInput('selectedColor', 'green');
    fixture.detectChanges();

    let icon = '';
    let color = '';
    fixture.componentInstance.iconChange.subscribe((v: string) => (icon = v));
    fixture.componentInstance.colorChange.subscribe((v: string) => (color = v));

    const iconBtns = fixture.nativeElement.querySelectorAll('.cog-avatar-picker__icon');
    const colorBtns = fixture.nativeElement.querySelectorAll(
      '.cog-avatar-picker__color',
    );
    expect(iconBtns[0].getAttribute('aria-checked')).toBe('true');

    iconBtns[1].click();
    colorBtns[1].click();
    expect(icon).toBe('rocket');
    expect(color).toBe('blue');
  });
});
