import { TestBed } from '@angular/core/testing';

import { describe, expect, it, vi } from 'vitest';

import { CognosMobileShellComponent } from './mobile-shell.component';

describe('CognosMobileShellComponent', () => {
  it('emits menuClick when the menu button is pressed', () => {
    const fixture = TestBed.createComponent(CognosMobileShellComponent);
    fixture.componentRef.setInput('menuButtonLabel', 'Open navigation');
    fixture.detectChanges();

    const listener = vi.fn();
    fixture.componentInstance.menuClick.subscribe(listener);

    const menuButton = fixture.nativeElement.querySelector(
      'cog-icon-button button',
    ) as HTMLButtonElement;
    menuButton.click();

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('hides the menu button when showMenuButton is false', () => {
    const fixture = TestBed.createComponent(CognosMobileShellComponent);
    fixture.componentRef.setInput('showMenuButton', false);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('cog-icon-button')).toBeNull();
  });

  it("re-emits the drawer's close event as drawerClose", () => {
    const fixture = TestBed.createComponent(CognosMobileShellComponent);
    fixture.componentRef.setInput('drawerOpen', true);
    fixture.detectChanges();

    const listener = vi.fn();
    fixture.componentInstance.drawerClose.subscribe(listener);

    (
      fixture.nativeElement.querySelector('.cog-drawer__scrim') as HTMLButtonElement
    ).click();

    expect(listener).toHaveBeenCalledTimes(1);
  });
});
