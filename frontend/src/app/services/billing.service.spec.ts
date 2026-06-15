import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';

import { of, throwError } from 'rxjs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BillingService } from './billing.service';
import { CognosApiService } from './cognos-api.service';
import { ErrorService } from './error.service';

describe('BillingService.beginCheckout', () => {
  let createCheckout: ReturnType<typeof vi.fn>;
  let alert: ReturnType<typeof vi.fn>;
  let location: { origin: string; href: string };

  const build = (): BillingService => {
    createCheckout = vi.fn();
    alert = vi.fn();
    location = { origin: 'https://app.test', href: '' };

    TestBed.configureTestingModule({
      providers: [
        BillingService,
        {
          provide: CognosApiService,
          useValue: {
            // Called in the constructor; return a benign trial state.
            getBilling: vi
              .fn()
              .mockReturnValue(
                of({ plan_type: 'trial', balance_chf: 2, trial_seed_chf: 2 }),
              ),
            createCheckout,
          },
        },
        { provide: ErrorService, useValue: { alert } },
        { provide: DOCUMENT, useValue: { location } },
      ],
    });

    return TestBed.inject(BillingService);
  };

  beforeEach(() => {
    TestBed.resetTestingModule();
  });

  // Sunny: redirects the browser to the URL Paddle returned, and asks for the
  // chosen plan with an activation return URL.
  it('redirects to the checkout url with the right plan and return url', () => {
    const service = build();
    createCheckout.mockReturnValue(of({ checkout_url: 'https://pay.paddle.com/x' }));

    service.beginCheckout('unlimited_annual');

    expect(createCheckout).toHaveBeenCalledWith({
      plan: 'unlimited_annual',
      returnUrl: 'https://app.test/pricing?status=activating',
    });
    expect(location.href).toBe('https://pay.paddle.com/x');
  });

  // Edge: a second click while a checkout is in flight is ignored (no double
  // charge / double redirect).
  it('ignores a second checkout while one is pending', () => {
    const service = build();
    // Never completes — keeps the checkout pending.
    createCheckout.mockReturnValue(of());

    service.beginCheckout('payg');
    service.beginCheckout('payg');

    expect(createCheckout).toHaveBeenCalledTimes(1);
    expect(service.checkoutPending()).toBe(true);
  });

  // Rainy: a failed checkout surfaces an error and clears pending so the user
  // can retry.
  it('reports an error and resets pending when checkout fails', () => {
    const service = build();
    createCheckout.mockReturnValue(throwError(() => new Error('boom')));

    service.beginCheckout('payg');

    expect(alert).toHaveBeenCalledOnce();
    expect(service.checkoutPending()).toBe(false);
    expect(location.href).toBe('');
  });
});
