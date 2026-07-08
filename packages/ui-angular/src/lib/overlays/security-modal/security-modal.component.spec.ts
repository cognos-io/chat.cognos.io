import { TestBed } from '@angular/core/testing';

import { describe, expect, it, vi } from 'vitest';

import {
  CognosSecurityModalComponent,
  DEFAULT_SECURITY_MODAL_CONTENT,
  type SecurityModalContent,
} from './security-modal.component';

describe('CognosSecurityModalComponent', () => {
  function render(
    inputs: {
      open?: boolean;
      fingerprint?: string;
      verified?: boolean;
      content?: SecurityModalContent;
    } = {},
  ) {
    const fixture = TestBed.createComponent(CognosSecurityModalComponent);
    fixture.componentRef.setInput('open', inputs.open ?? true);
    fixture.componentRef.setInput('fingerprint', inputs.fingerprint ?? '');
    fixture.componentRef.setInput('verified', inputs.verified ?? false);
    if (inputs.content) {
      fixture.componentRef.setInput('content', inputs.content);
    }
    fixture.detectChanges();
    return fixture;
  }

  it('renders the encryption explainer when open', () => {
    const fixture = render();
    const text = fixture.nativeElement.textContent as string;

    expect(text).toContain('Encrypted on this device');
    expect(text).toContain('Only you can read them');
    expect(text).toContain('Search runs locally');
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

  it('renders the region-aware compute step, detail rows and links from content', () => {
    const content: SecurityModalContent = {
      ...DEFAULT_SECURITY_MODAL_CONTENT,
      computeFlag: '🇪🇺',
      computeTitle: 'EU gateway',
      rows: [
        { icon: 'sparkles', label: 'Model', value: 'Some Model · Some Provider' },
        { icon: 'eraser', label: 'Auto-delete', value: 'After 30 days' },
      ],
      links: [
        { label: 'How we keep it private', href: 'https://example.test/security' },
      ],
    };
    const fixture = render({ content });
    const text = fixture.nativeElement.textContent as string;

    expect(text).toContain('EU gateway');
    expect(text).toContain('🇪🇺');
    expect(text).toContain('Some Model · Some Provider');
    expect(text).toContain('After 30 days');

    const link = fixture.nativeElement.querySelector(
      '.cog-security-modal__link',
    ) as HTMLAnchorElement;
    expect(link.getAttribute('href')).toBe('https://example.test/security');
    expect(link.getAttribute('target')).toBe('_blank');
    expect(link.getAttribute('rel')).toBe('noopener noreferrer');
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
