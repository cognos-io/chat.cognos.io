import { TestBed } from '@angular/core/testing';

import { describe, expect, it, vi } from 'vitest';

import { CognosSecurityModalComponent } from './security-modal.component';

describe('CognosSecurityModalComponent', () => {
  function render(
    inputs: { open?: boolean; fingerprint?: string; verified?: boolean } = {},
  ) {
    const fixture = TestBed.createComponent(CognosSecurityModalComponent);
    fixture.componentRef.setInput('open', inputs.open ?? true);
    fixture.componentRef.setInput('fingerprint', inputs.fingerprint ?? '');
    fixture.componentRef.setInput('verified', inputs.verified ?? false);
    fixture.detectChanges();
    return fixture;
  }

  it('renders the encryption explainer when open', () => {
    const fixture = render();
    const text = fixture.nativeElement.textContent as string;

    expect(text).toContain('Encrypted on this device');
    expect(text).toContain('Only you can read them');
    expect(text).toContain('The one honest caveat');
  });

  it('renders nothing when closed', () => {
    const fixture = render({ open: false });

    expect(fixture.nativeElement.querySelector('.cog-security-modal')).toBeNull();
  });

  it('omits the device key row when no fingerprint is supplied', () => {
    const fixture = render({ fingerprint: '' });

    expect(fixture.nativeElement.querySelector('.cog-security-modal__keys')).toBeNull();
  });

  it('shows the device key fingerprint and a verified lozenge when verified', () => {
    const fixture = render({ fingerprint: '9F2A · 7C41 · DD08', verified: true });
    const keys = fixture.nativeElement.querySelector(
      '.cog-security-modal__keys',
    ) as HTMLElement;

    expect(keys).not.toBeNull();
    expect(keys.textContent).toContain('9F2A · 7C41 · DD08');
    expect(keys.querySelector('.cog-lozenge')?.textContent?.trim()).toBe('Verified');
  });

  it('hides the verified lozenge when the key is not verified', () => {
    const fixture = render({ fingerprint: '9F2A · 7C41 · DD08', verified: false });

    expect(
      fixture.nativeElement.querySelector('.cog-security-modal__keys .cog-lozenge'),
    ).toBeNull();
  });

  it('emits close when the footer action is pressed', () => {
    const fixture = render();
    const listener = vi.fn();
    fixture.componentInstance.close.subscribe(listener);

    const gotIt = Array.from(fixture.nativeElement.querySelectorAll('button')).find(
      (button) => (button as HTMLButtonElement).textContent?.includes('Got it'),
    ) as HTMLButtonElement;
    gotIt.click();

    expect(listener).toHaveBeenCalledTimes(1);
  });
});
