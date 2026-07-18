import { TestBed } from '@angular/core/testing';

import { describe, expect, it } from 'vitest';

import { CognosButtonComponent } from './button.component';

describe('CognosButtonComponent', () => {
  function render(inputs: Record<string, unknown> = {}) {
    const fixture = TestBed.createComponent(CognosButtonComponent);
    for (const [key, value] of Object.entries(inputs)) {
      fixture.componentRef.setInput(key, value);
    }
    fixture.detectChanges();
    return fixture;
  }

  it('composes default appearance and size classes', () => {
    const fixture = render();
    const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;

    expect(button.className).toContain('cog-button--default');
    expect(button.className).toContain('cog-button--md');
    expect(button.className).not.toContain('cog-button--full-width');
  });

  it('reflects the appearance and size inputs', () => {
    const fixture = render({ appearance: 'primary', size: 'lg' });
    const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;

    expect(button.className).toContain('cog-button--primary');
    expect(button.className).toContain('cog-button--lg');
  });

  it('adds a full-width modifier on the button and host element', () => {
    const fixture = render({ fullWidth: true });
    const host = fixture.nativeElement as HTMLElement;
    const button = host.querySelector('button') as HTMLButtonElement;

    expect(button.className).toContain('cog-button--full-width');
    expect(host.classList.contains('cog-button-host--full-width')).toBe(true);
  });

  it('forwards disabled, title and type attributes to the native button', () => {
    const fixture = render({
      disabled: true,
      title: 'Locks your account and does not log you out.',
      type: 'submit',
    });
    const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;

    expect(button.disabled).toBe(true);
    expect(button.getAttribute('title')).toBe(
      'Locks your account and does not log you out.',
    );
    expect(button.getAttribute('type')).toBe('submit');
  });

  it('forwards an accessible label when supplied', () => {
    const fixture = render({ ariaLabel: 'Remove Pat' });
    const button = fixture.nativeElement.querySelector('button') as HTMLButtonElement;

    expect(button.getAttribute('aria-label')).toBe('Remove Pat');
  });
});
