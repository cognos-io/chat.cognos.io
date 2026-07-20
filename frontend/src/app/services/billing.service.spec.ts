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

    service.beginCheckout('unlimited_annual', 'pricing');

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

    service.beginCheckout('payg', 'pricing');
    service.beginCheckout('payg', 'pricing');

    expect(createCheckout).toHaveBeenCalledTimes(1);
    expect(service.checkoutPending()).toBe(true);
  });

  // Rainy: a failed checkout surfaces an error and clears pending so the user
  // can retry.
  it('reports an error and resets pending when checkout fails', () => {
    const service = build();
    createCheckout.mockReturnValue(throwError(() => new Error('boom')));

    service.beginCheckout('payg', 'pricing');

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

    service.beginCheckout('payg', 'pricing');
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

    service.beginCheckout('payg', 'pricing');

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

describe('BillingService PAYG usage vs minimum', () => {
  const build = (opts: {
    minCommitChf?: number;
    usageCostsChf?: number[];
    usageFails?: boolean;
  }): BillingService => {
    const getBilling = vi.fn().mockReturnValue(
      of({
        plan_type: 'payg',
        status: 'active',
        balance_chf: 0,
        trial_seed_chf: 0,
        payg_min_commit_chf: opts.minCommitChf,
      }),
    );
    const getBillingUsage = vi.fn().mockReturnValue(
      opts.usageFails
        ? throwError(() => new Error('unavailable'))
        : of({
            period_start: '2026-06-01T00:00:00Z',
            message_count: opts.usageCostsChf?.length ?? 0,
            by_model: (opts.usageCostsChf ?? []).map((cost, i) => ({
              model_id: `model-${i}`,
              count: 1,
              cost_chf: cost,
            })),
          }),
    );
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        BillingService,
        { provide: CognosApiService, useValue: { getBilling, getBillingUsage } },
        { provide: ErrorService, useValue: { alert: vi.fn() } },
        {
          provide: PaddleService,
          useValue: { enabled: false, checkoutCompleted$: new Subject() },
        },
        { provide: Router, useValue: { navigate: vi.fn() } },
        { provide: AuthService, useValue: { email: () => '' } },
        {
          provide: DOCUMENT,
          useValue: { location: { href: '' }, defaultView: { open: vi.fn() } },
        },
      ],
    });
    return TestBed.inject(BillingService);
  };

  // Sunny: usage below the minimum is covered by it — no overage.
  it('sums per-model usage and reports no overage below the minimum', () => {
    const service = build({ minCommitChf: 15, usageCostsChf: [1.2, 2.22] });
    expect(service.isPayg()).toBe(true);
    expect(service.paygUsageChf()).toBeCloseTo(3.42);
    expect(service.paygMinCommitChf()).toBe(15);
    expect(service.paygOverageChf()).toBe(0);
  });

  // Sunny: anything above the minimum is the overage Paddle bills automatically.
  it('reports the overage once usage passes the minimum', () => {
    const service = build({ minCommitChf: 15, usageCostsChf: [20, 3.4] });
    expect(service.paygUsageChf()).toBeCloseTo(23.4);
    expect(service.paygOverageChf()).toBeCloseTo(8.4);
  });

  // Rainy: an older backend without the field still shows a sane minimum.
  it('falls back to CHF 15 when the API omits the minimum', () => {
    const service = build({ usageCostsChf: [] });
    expect(service.paygMinCommitChf()).toBe(15);
  });

  // Rainy: a failed usage fetch leaves the total unknown rather than lying
  // with a zero, and the overage stays zero (informational, never a gate).
  it('keeps usage null and overage zero when the usage endpoint fails', () => {
    const service = build({ minCommitChf: 15, usageFails: true });
    expect(service.paygUsageChf()).toBeNull();
    expect(service.paygOverageChf()).toBe(0);
  });
});

describe('BillingService org billing block', () => {
  const build = (): BillingService => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        BillingService,
        {
          provide: CognosApiService,
          useValue: {
            getBilling: vi
              .fn()
              .mockReturnValue(
                of({ plan_type: 'trial', balance_chf: 2, trial_seed_chf: 2 }),
              ),
          },
        },
        { provide: ErrorService, useValue: { alert: vi.fn() } },
        {
          provide: PaddleService,
          useValue: { enabled: false, checkoutCompleted$: new Subject() },
        },
        { provide: Router, useValue: { navigate: vi.fn() } },
        { provide: AuthService, useValue: { email: () => '' } },
        {
          provide: DOCUMENT,
          useValue: { location: { href: '' }, defaultView: { open: vi.fn() } },
        },
      ],
    });
    return TestBed.inject(BillingService);
  };

  const orgRestriction = (organisationId = 'org_1') =>
    ({
      code: 'ORG_BILLING_PAST_DUE',
      organisationId,
      organisationName: 'Acme',
      message: 'Acme billing is paused.',
      adminMessage: 'Update the payment method.',
    }) as const;

  // The hard line (persona PER-006): an org billing block never locks the
  // member's personal workspace or mutates their own plan state.
  it('records the org block without touching personal plan state or the send lock', () => {
    const service = build();

    service.markOrgSendingBlocked(orgRestriction());

    expect(service.orgSendBlock()).toEqual(orgRestriction());
    expect(service.isSendingLocked()).toBe(false);
    expect(service.planType()).toBe('trial');
    expect(service.balanceChf()).toBe(2);
  });

  it('clears the block only for the matching organisation', () => {
    const service = build();
    service.markOrgSendingBlocked(orgRestriction('org_1'));

    // A successful send in another org (or personal) context never hides it.
    service.clearOrgSendingBlocked('org_other');
    expect(service.orgSendBlock()).not.toBeNull();

    service.clearOrgSendingBlocked('org_1');
    expect(service.orgSendBlock()).toBeNull();
  });

  it('clears unconditionally when no organisation id is given', () => {
    const service = build();
    service.markOrgSendingBlocked(orgRestriction());

    service.clearOrgSendingBlocked();

    expect(service.orgSendBlock()).toBeNull();
  });

  it('is a no-op to clear when nothing is blocked', () => {
    const service = build();
    expect(() => service.clearOrgSendingBlocked('org_1')).not.toThrow();
    expect(service.orgSendBlock()).toBeNull();
  });
});
