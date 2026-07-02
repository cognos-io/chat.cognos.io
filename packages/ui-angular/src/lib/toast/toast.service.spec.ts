import { describe, expect, it, vi } from 'vitest';

import { CognosToastService } from './toast.service';

describe('CognosToastService', () => {
  it('adds a toast with default tone metadata', () => {
    const service = new CognosToastService();
    vi.spyOn(globalThis, 'setTimeout').mockReturnValue(0 as never);

    service.notify({ title: 'Saved' });

    expect(service.items()).toHaveLength(1);
    expect(service.items()[0]).toMatchObject({
      title: 'Saved',
      tone: 'success',
      icon: 'shield-check',
      duration: 3400,
    });
  });

  it('still issues a toast id when crypto.randomUUID is unavailable', () => {
    // Non-secure-context origins (e.g. plain-http dev) have no crypto.randomUUID;
    // a toast must never throw.
    const service = new CognosToastService();
    vi.spyOn(globalThis, 'setTimeout').mockReturnValue(0 as never);
    const original = globalThis.crypto?.randomUUID;
    if (globalThis.crypto) {
      // @ts-expect-error force the missing-API case
      globalThis.crypto.randomUUID = undefined;
    }

    try {
      const id = service.notify({ title: 'Copied' });
      expect(typeof id).toBe('string');
      expect(id.length).toBeGreaterThan(0);
      expect(service.items()).toHaveLength(1);
    } finally {
      if (globalThis.crypto && original) {
        globalThis.crypto.randomUUID = original;
      }
    }
  });

  it('does not schedule auto-dismiss for a sticky (duration <= 0) toast', () => {
    const service = new CognosToastService();
    const setTimeoutSpy = vi
      .spyOn(globalThis, 'setTimeout')
      .mockReturnValue(0 as never);
    // The spy is shared across tests in this file; reset its call history so we
    // only observe this notify() call.
    setTimeoutSpy.mockClear();

    service.notify({ title: 'Long error', msg: 'stays up', duration: 0 });

    expect(service.items()).toHaveLength(1);
    expect(setTimeoutSpy).not.toHaveBeenCalled();
  });

  it('runs an action and dismisses the toast', () => {
    const service = new CognosToastService();
    vi.spyOn(globalThis, 'setTimeout').mockReturnValue(0 as never);
    const action = vi.fn();

    service.notify({
      title: 'Link copied',
      action: { label: 'Undo', onClick: action },
    });
    const toast = service.items()[0];
    service.runAction(toast);

    expect(action).toHaveBeenCalledTimes(1);
    expect(service.items()).toHaveLength(0);
  });
});
