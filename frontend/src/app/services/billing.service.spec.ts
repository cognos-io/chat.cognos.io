import { DOCUMENT } from '@angular/common';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { Subject, of, throwError } from 'rxjs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AuthService } from './auth.service';
import { BillingService } from './billing.service';
import { CognosApiService } from './cognos-api.service';
import { ErrorService } from './error.service';
import { PaddleService } from './paddle.service';

describe('BillingService.beginCheckout', () => {
  let createCheckout: ReturnType<typeof vi.fn>;
  let createPortalSession: ReturnType<typeof vi.fn>;
  let alert: ReturnType<typeof vi.fn>;
  let openCheckout: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.fn>;
  let location: { origin: string; href: string };
  let openedTabs: { location: { href: string }; opener: unknown; close: () => void }[];
  let windowOpen: ReturnType<typeof vi.fn>;
  let paddleEnabled: boolean;
  let completed: Subject<void>;

  const build = (): BillingService => {
    createCheckout = vi.fn();
    createPortalSession = vi.fn();
    alert = vi.fn();
    openCheckout = vi.fn().mockResolvedValue(true);
    navigate = vi.fn();
    location = { origin: 'https://app.test', href: '' };
    openedTabs = [];
    windowOpen = vi.fn(() => {
      const tab = { location: { href: '' }, opener: {} as unknown, close: vi.fn() };
      openedTabs.push(tab);
      return tab;
    });
    paddleEnabled = false;
    completed = new Subject<void>();

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
            createPortalSession,
          },
        },
        { provide: ErrorService, useValue: { alert } },
        {
          provide: PaddleService,
          useValue: {
            get enabled() {
              return paddleEnabled;
            },
            openCheckout,
            checkoutCompleted$: completed,
          },
        },
        { provide: Router, useValue: { navigate } },
        { provide: AuthService, useValue: { email: () => 'user@example.com' } },
        {
          provide: DOCUMENT,
          useValue: { location, defaultView: { open: windowOpen } },
        },
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

  // Sunny: with the overlay enabled and a transaction id, open the overlay
  // (no redirect) instead of navigating away.
  it('opens the Paddle overlay for a transaction id instead of redirecting', async () => {
    const service = build();
    paddleEnabled = true;
    createCheckout.mockReturnValue(
      of({ transaction_id: 'txn_1', checkout_url: 'https://pay.paddle.com/x' }),
    );

    service.beginCheckout('payg');
    await Promise.resolve();

    // openCheckout receives the transaction id, the user's email, and the
    // Paddle locale derived from the active language (English → 'en').
    expect(openCheckout).toHaveBeenCalledWith('txn_1', 'user@example.com', 'en');
    expect(location.href).toBe('');
    expect(service.checkoutPending()).toBe(false);
  });

  // Edge: overlay configured but the transaction id is missing → hosted fallback.
  it('falls back to the hosted url when there is no transaction id', () => {
    const service = build();
    paddleEnabled = true;
    createCheckout.mockReturnValue(of({ checkout_url: 'https://pay.paddle.com/x' }));

    service.beginCheckout('payg');

    expect(openCheckout).not.toHaveBeenCalled();
    expect(location.href).toBe('https://pay.paddle.com/x');
  });
});

describe('BillingService.changePlan', () => {
  let changePlan: ReturnType<typeof vi.fn>;
  let getBilling: ReturnType<typeof vi.fn>;
  let location: { origin: string; href: string };

  const build = (): BillingService => {
    changePlan = vi.fn();
    getBilling = vi
      .fn()
      .mockReturnValue(
        of({ plan_type: 'unlimited', balance_chf: 0, trial_seed_chf: 0 }),
      );
    location = { origin: 'https://app.test', href: '' };

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        BillingService,
        { provide: CognosApiService, useValue: { getBilling, changePlan } },
        { provide: ErrorService, useValue: { alert: vi.fn() } },
        {
          provide: PaddleService,
          useValue: { enabled: false, checkoutCompleted$: new Subject() },
        },
        { provide: Router, useValue: { navigate: vi.fn() } },
        { provide: AuthService, useValue: { email: () => 'user@example.com' } },
        {
          provide: DOCUMENT,
          useValue: { location, defaultView: { open: vi.fn() } },
        },
      ],
    });
    return TestBed.inject(BillingService);
  };

  // Sunny: a 'changed' outcome re-fetches the authoritative plan state and never
  // redirects the browser.
  it('refreshes state and does not redirect when the plan changed in place', () => {
    const service = build();
    changePlan.mockReturnValue(of({ status: 'changed' }));
    getBilling.mockClear(); // ignore the constructor refresh

    service.changePlan('unlimited_annual').subscribe();

    expect(changePlan).toHaveBeenCalledWith({
      plan: 'unlimited_annual',
      returnUrl: 'https://app.test/account/billing?status=activating',
    });
    expect(getBilling).toHaveBeenCalledTimes(1); // the refresh()
    expect(location.href).toBe('');
  });

  // A 'checkout' outcome (no live subscription) falls back to the hosted checkout.
  it('redirects to checkout when the backend has no subscription to change', () => {
    const service = build();
    changePlan.mockReturnValue(
      of({ status: 'checkout', checkout_url: 'https://pay.paddle.com/new' }),
    );

    service.changePlan('unlimited_monthly').subscribe();

    expect(location.href).toBe('https://pay.paddle.com/new');
  });
});

describe('BillingService.openPortal', () => {
  let createPortalSession: ReturnType<typeof vi.fn>;
  let alert: ReturnType<typeof vi.fn>;
  let openedTab: { location: { href: string }; opener: unknown; close: () => void };
  let windowOpen: ReturnType<typeof vi.fn>;

  const build = (): BillingService => {
    createPortalSession = vi.fn();
    alert = vi.fn();
    openedTab = { location: { href: '' }, opener: {} as unknown, close: vi.fn() };
    windowOpen = vi.fn(() => openedTab);

    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        BillingService,
        {
          provide: CognosApiService,
          useValue: {
            getBilling: vi.fn().mockReturnValue(of({ plan_type: 'trial' })),
            createPortalSession,
          },
        },
        { provide: ErrorService, useValue: { alert } },
        {
          provide: PaddleService,
          useValue: { enabled: false, checkoutCompleted$: new Subject() },
        },
        { provide: Router, useValue: { navigate: vi.fn() } },
        { provide: AuthService, useValue: { email: () => 'user@example.com' } },
        {
          provide: DOCUMENT,
          useValue: { location: { href: '' }, defaultView: { open: windowOpen } },
        },
      ],
    });
    return TestBed.inject(BillingService);
  };

  // Sunny: opens a tab synchronously then points it at the payment deep link,
  // and severs the opener for security.
  it('points a new tab at the payment deep link', () => {
    const service = build();
    createPortalSession.mockReturnValue(
      of({
        overview_url: 'https://portal/over',
        update_payment_url: 'https://portal/pay',
      }),
    );

    service.openPortal('payment');

    expect(windowOpen).toHaveBeenCalledWith('about:blank', '_blank');
    expect(openedTab.opener).toBeNull();
    expect(openedTab.location.href).toBe('https://portal/pay');
  });

  // Edge: no payment deep link → fall back to the overview link.
  it('falls back to the overview link when no payment deep link exists', () => {
    const service = build();
    createPortalSession.mockReturnValue(of({ overview_url: 'https://portal/over' }));

    service.openPortal('payment');

    expect(openedTab.location.href).toBe('https://portal/over');
  });

  // Rainy: a failed portal call closes the blank tab and alerts.
  it('closes the tab and alerts when the portal call fails', () => {
    const service = build();
    createPortalSession.mockReturnValue(throwError(() => new Error('boom')));

    service.openPortal('overview');

    expect(openedTab.close).toHaveBeenCalledOnce();
    expect(alert).toHaveBeenCalledOnce();
  });
});

describe('BillingService.pollActivation', () => {
  let getBilling: ReturnType<typeof vi.fn>;
  let navigate: ReturnType<typeof vi.fn>;

  const build = (planType: string): BillingService => {
    getBilling = vi.fn().mockReturnValue(
      of({
        plan_type: planType,
        status: 'active',
        balance_chf: 0,
        trial_seed_chf: 0,
      }),
    );
    navigate = vi.fn();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        BillingService,
        { provide: CognosApiService, useValue: { getBilling } },
        { provide: ErrorService, useValue: { alert: vi.fn() } },
        {
          provide: PaddleService,
          useValue: { enabled: false, checkoutCompleted$: new Subject() },
        },
        { provide: Router, useValue: { navigate } },
        { provide: AuthService, useValue: { email: () => '' } },
        {
          provide: DOCUMENT,
          useValue: { location: { href: '' }, defaultView: { open: vi.fn() } },
        },
      ],
    });
    return TestBed.inject(BillingService);
  };

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    TestBed.resetTestingModule();
  });

  // Regression: once the plan goes live the poll must STOP. Previously the timer
  // kept firing every interval, re-navigating to '/' and yanking the user out of
  // any screen (e.g. their profile) they opened.
  it('navigates once and stops polling after the plan activates', () => {
    const service = build('unlimited');
    getBilling.mockClear(); // ignore the constructor's refresh()
    navigate.mockClear();

    service.pollActivation();
    vi.advanceTimersByTime(10000); // several poll intervals

    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(['/']);
    expect(getBilling).toHaveBeenCalledTimes(1);
    expect(service.activating()).toBe(false);
  });

  // While still on the trial it keeps polling and never navigates.
  it('keeps polling without navigating while the plan is not yet active', () => {
    const service = build('trial');
    getBilling.mockClear();
    navigate.mockClear();

    service.pollActivation();
    vi.advanceTimersByTime(6000); // ~3 intervals

    expect(navigate).not.toHaveBeenCalled();
    expect(getBilling.mock.calls.length).toBeGreaterThan(1);
    expect(service.activating()).toBe(true);
  });
});
