import { TestBed } from '@angular/core/testing';

import { describe, expect, it, vi } from 'vitest';

import {
  CognosRedactedTextComponent,
  type CognosRedactedTextKind,
} from './redacted-text.component';

describe('CognosRedactedTextComponent', () => {
  function render(inputs: Record<string, unknown>) {
    const fixture = TestBed.createComponent(CognosRedactedTextComponent);
    fixture.componentRef.setInput('value', 'alice@example.com');
    fixture.componentRef.setInput('placeholder', '[email]');
    for (const [key, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(key, value);
    }
    fixture.detectChanges();
    return fixture;
  }

  it('keeps the modal closed initially', () => {
    const fixture = render({});
    expect(fixture.nativeElement.querySelector('.cog-modal')).toBeNull();
  });

  it('shows the value inline by default', () => {
    const fixture = render({});
    const inline = fixture.nativeElement.querySelector(
      '.cog-redacted-text span',
    ) as HTMLElement;
    expect(inline.textContent).toContain('alice@example.com');
  });

  it('masks the inline value when masked, without leaking it', () => {
    const fixture = render({ masked: true });
    const inline = fixture.nativeElement.querySelector(
      '.cog-redacted-text span',
    ) as HTMLElement;
    expect(inline.textContent).not.toContain('alice@example.com');
    expect(inline.textContent).toContain('••••••');
  });

  it('opens the modal when the inline trigger is clicked', () => {
    const fixture = render({});
    const trigger = fixture.nativeElement.querySelector(
      '.cog-redacted-text',
    ) as HTMLElement;

    trigger.click();
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('.cog-modal')).toBeTruthy();
  });

  it.each(['Enter', ' '])(
    'opens the modal when %s is pressed on the trigger',
    (key) => {
      const fixture = render({});
      const trigger = fixture.nativeElement.querySelector(
        '.cog-redacted-text',
      ) as HTMLElement;
      const event = new KeyboardEvent('keydown', { key, cancelable: true });
      trigger.dispatchEvent(event);
      fixture.detectChanges();

      expect(event.defaultPrevented).toBe(true);
      expect(fixture.nativeElement.querySelector('.cog-modal')).toBeTruthy();
    },
  );

  it('ignores other keys on the trigger', () => {
    const fixture = render({});
    const trigger = fixture.nativeElement.querySelector(
      '.cog-redacted-text',
    ) as HTMLElement;
    const event = new KeyboardEvent('keydown', { key: 'a', cancelable: true });
    trigger.dispatchEvent(event);
    fixture.detectChanges();

    expect(event.defaultPrevented).toBe(false);
    expect(fixture.nativeElement.querySelector('.cog-modal')).toBeNull();
  });

  it.each<[CognosRedactedTextKind, string]>([
    ['name', 'Name'],
    ['email', 'Email address'],
    ['phone', 'Phone number'],
    ['case-id', 'Case ID'],
  ])('uses a built-in label for the %s kind', (kind, label) => {
    const fixture = render({ kind });
    (fixture.nativeElement.querySelector('.cog-redacted-text') as HTMLElement).click();
    fixture.detectChanges();

    const lozenge = fixture.nativeElement.querySelector('cog-lozenge');
    expect(lozenge?.textContent?.trim()).toContain(label);
  });

  it('falls back to the custom label for the custom kind', () => {
    const fixture = render({ kind: 'custom', label: 'Project ref' });
    (fixture.nativeElement.querySelector('.cog-redacted-text') as HTMLElement).click();
    fixture.detectChanges();

    const lozenge = fixture.nativeElement.querySelector('cog-lozenge');
    expect(lozenge?.textContent?.trim()).toContain('Project ref');
  });

  it('copies the original value to the clipboard from the Copy button', async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    const fixture = render({ value: 'secret@example.com' });
    (fixture.nativeElement.querySelector('.cog-redacted-text') as HTMLElement).click();
    fixture.detectChanges();

    const copyButton = [
      ...fixture.nativeElement.querySelectorAll('cog-button button'),
    ].find(
      (node) => (node as HTMLElement).textContent?.trim() === 'Copy',
    ) as HTMLButtonElement;

    copyButton.click();

    expect(writeText).toHaveBeenCalledWith('secret@example.com');
  });

  it('emits openSettings when the settings link is clicked', () => {
    const fixture = render({});
    (fixture.nativeElement.querySelector('.cog-redacted-text') as HTMLElement).click();
    fixture.detectChanges();

    const listener = vi.fn();
    fixture.componentInstance.openSettings.subscribe(listener);

    const settingsButton = [
      ...fixture.nativeElement.querySelectorAll('cog-button button'),
    ].find((node) =>
      (node as HTMLElement).textContent?.includes('Redaction settings'),
    ) as HTMLButtonElement;

    settingsButton.click();

    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('omits the settings link when showSettings is false', () => {
    const fixture = render({ showSettings: false });
    (fixture.nativeElement.querySelector('.cog-redacted-text') as HTMLElement).click();
    fixture.detectChanges();

    const labels = [...fixture.nativeElement.querySelectorAll('cog-button button')].map(
      (node) => (node as HTMLElement).textContent?.trim(),
    );

    expect(labels).not.toContain('Redaction settings');
  });
});
