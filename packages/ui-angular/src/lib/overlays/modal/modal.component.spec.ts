import { TestBed } from '@angular/core/testing';
import { By } from '@angular/platform-browser';

import { describe, expect, it, vi } from 'vitest';

import { CognosIconComponent } from '../../icon/icon.component';
import { CognosModalComponent } from './modal.component';

describe('CognosModalComponent', () => {
  it('renders nothing when closed', () => {
    const fixture = TestBed.createComponent(CognosModalComponent);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.cog-modal')).toBeNull();
  });

  it('renders the panel with the configured title and width', () => {
    const fixture = TestBed.createComponent(CognosModalComponent);
    fixture.componentRef.setInput('open', true);
    fixture.componentRef.setInput('title', 'Confirm');
    fixture.componentRef.setInput('width', 720);
    fixture.detectChanges();

    const panel = fixture.nativeElement.querySelector(
      '.cog-modal__panel',
    ) as HTMLElement;
    const title = fixture.nativeElement.querySelector('.cog-modal__title');

    expect(panel).toBeTruthy();
    expect(panel.style.getPropertyValue('--_modal-width')).toBe('720px');
    expect(title?.textContent?.trim()).toBe('Confirm');
  });

  it('adds the footer modifier when stickyFooter is set', () => {
    const fixture = TestBed.createComponent(CognosModalComponent);
    fixture.componentRef.setInput('open', true);
    fixture.componentRef.setInput('stickyFooter', true);
    fixture.detectChanges();

    const panel = fixture.nativeElement.querySelector(
      '.cog-modal__panel',
    ) as HTMLElement;
    expect(panel.className).toContain('cog-modal__panel--footer');
  });

  it('renders an optional title icon with the requested tone', () => {
    const fixture = TestBed.createComponent(CognosModalComponent);
    fixture.componentRef.setInput('open', true);
    fixture.componentRef.setInput('title', 'Shred this file?');
    fixture.componentRef.setInput('titleIcon', 'shield-x');
    fixture.componentRef.setInput('titleTone', 'danger');
    fixture.detectChanges();

    const iconBadge = fixture.nativeElement.querySelector(
      '.cog-modal__title-icon',
    ) as HTMLElement;
    const icon = fixture.debugElement.query(By.directive(CognosIconComponent))
      .componentInstance as CognosIconComponent;

    expect(iconBadge.className).toContain('cog-modal__title-icon--danger');
    expect(icon.name()).toBe('shield-x');
    expect(icon.tone()).toBe('danger');
  });

  it('emits close when the scrim is clicked', () => {
    const fixture = TestBed.createComponent(CognosModalComponent);
    fixture.componentRef.setInput('open', true);
    fixture.detectChanges();

    const listener = vi.fn();
    fixture.componentInstance.close.subscribe(listener);

    (
      fixture.nativeElement.querySelector('.cog-modal__scrim') as HTMLButtonElement
    ).click();

    expect(listener).toHaveBeenCalledTimes(1);
  });
});
