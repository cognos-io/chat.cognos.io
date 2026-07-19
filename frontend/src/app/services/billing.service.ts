import { DOCUMENT } from '@angular/common';
import { Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';

import { Observable, switchMap, take, takeWhile, tap, timer } from 'rxjs';

import { TranslocoService } from '@jsverse/transloco';

import { paddleLocaleFor } from '@app/i18n/languages';
import {
  BillingApiResponse,
  BillingState,
  ChangePlanResponse,
  CheckoutPlan,
  CheckoutResponse,
  CompletionBillingRestriction,
  OrgCompletionBillingRestriction,
} from '@app/interfaces/billing';
import { Analytics } from '@app/services/analytics/analytics';
import { AuthService } from '@app/services/auth.service';
import { CognosApiService } from '@app/services/cognos-api.service';
import { ErrorService } from '@app/services/error.service';
import { LanguageService } from '@app/services/language.service';
import { PaddleService } from '@app/services/paddle.service';
import { parseOrgBillingRestriction } from '@app/utils/org-billing-restriction';

// How long to wait for the subscription.created webhook before telling the user
// it's taking longer than usual. ~100s at a cache-warm 2.5s cadence.
const ACTIVATION_POLL_INTERVAL_MS = 2500;
const ACTIVATION_POLL_MAX_ATTEMPTS = 40;

// Fallback for the PAYG monthly minimum until the API responds. The server
// value (payg_min_commit_chf) is authoritative — this only avoids showing
// CHF 0.00 during the first load.
const DEFAULT_PAYG_MIN_COMMIT_CHF = 15;

// Which surface a checkout was started from — the `entry` prop on the
// `checkout_started` analytics event (docs/specs/product-analytics.md §7.2).
export type CheckoutEntry = 'pricing' | 'trial_lock' | 'billing';

// The analytics `plan` prop is the coarse plan family, not the billing
// interval (spec enum: payg | unlimited).
const checkoutPlanProp = (plan: CheckoutPlan): 'payg' | 'unlimited' =>
  plan === 'payg' ? 'payg' : 'unlimited';

// BillingService is the frontend's single source of truth for the user's plan
// state. It backs the trial pill/credit card, the locked-chat surfaces, and the
// pricing page. The balance is shown to the user but is never authoritative —
// the backend ledger is. We optimistically decrement it as completions land so
// the pill feels live, then reconcile on the next refresh.
@Injectable({
  providedIn: 'root',
})
export class BillingService {
  private readonly _api = inject(CognosApiService);
  private readonly _document = inject(DOCUMENT);
  private readonly _errors = inject(ErrorService);
  private readonly _paddle = inject(PaddleService);
  private readonly _router = inject(Router);
  private readonly _auth = inject(AuthService);
  private readonly _language = inject(LanguageService);
  private readonly _transloco = inject(TranslocoService);
  private readonly _analytics = inject(Analytics);

  // Last plan a checkout was started for, so `checkout_completed` (which the
  // Paddle overlay reports without context) can carry the plan prop.
  private _lastCheckoutPlan: 'payg' | 'unlimited' | null = null;
  // trial_exhausted fires at most once per session — the first blocking 402,
  // not every blocked send attempt.
  private _trialExhaustedTracked = false;

  private readonly _state = signal<BillingState | null>(null);
  // This cycle's PAYG usage total (CHF); null until fetched for a PAYG plan.
  private readonly _paygUsageChf = signal<number | null>(null);
  private readonly _checkoutPending = signal(false);
  private readonly _activating = signal(false);
  private readonly _activationSlow = signal(false);

  // Set when a /complete call is rejected for billing reasons this session.
  // A used-up trial keeps plan_type='trial' with a near-zero (but not always
  // exactly zero) balance, so the server 402 is the most reliable "you can no
  // longer send" signal mid-session.
  private readonly _sendBlocked = signal(false);

  // Set when a /complete call in an org-owned Project is rejected because the
  // owning Organisation's billing is inactive or past due (fail closed, spec
  // §5.8). Deliberately SEPARATE from the personal plan state: an org pause
  // never locks the personal workspace and never reads as the member's fault.
  private readonly _orgSendBlock = signal<OrgCompletionBillingRestriction | null>(null);

  /** The active org billing block, or null. Scoped to one Organisation. */
  readonly orgSendBlock = this._orgSendBlock.asReadonly();

  readonly state = this._state.asReadonly();
  readonly planType = computed(() => this._state()?.planType ?? null);
  readonly balanceChf = computed(() => this._state()?.balanceChf ?? 0);
  readonly trialSeedChf = computed(() => this._state()?.trialSeedChf ?? 0);
  readonly isTrial = computed(() => this.planType() === 'trial');
  // Unlimited plans aren't billed per message, so per-model cost framing is
  // irrelevant and hidden for them.
  readonly isUnlimited = computed(() => this.planType() === 'unlimited');
  // Pay-as-you-go: metered usage billed monthly with a minimum charge. There
  // is no prepaid credit and nothing to top up — usage below the minimum is
  // covered by it, and anything above is added to the next invoice
  // automatically by Paddle. The sidebar shows the running monthly cost.
  readonly isPayg = computed(() => this.planType() === 'payg');
  // The PAYG monthly minimum charge, as configured server-side.
  readonly paygMinCommitChf = computed(
    () => this._state()?.paygMinCommitChf ?? DEFAULT_PAYG_MIN_COMMIT_CHF,
  );
  // This cycle's metered usage in CHF; null until the usage endpoint responds.
  readonly paygUsageChf = computed(() => this._paygUsageChf());
  // Usage beyond the minimum — the part that will appear as an extra line on
  // the next invoice. Zero while usage is still covered by the minimum.
  readonly paygOverageChf = computed(() =>
    Math.max(0, (this._paygUsageChf() ?? 0) - this.paygMinCommitChf()),
  );

  // Sending is locked when there's no active plan, or a trial whose credit is
  // spent (server said so this session, or the balance has reached zero).
  readonly isSendingLocked = computed(() => {
    if (this.planType() === 'inactive') {
      return true;
    }
    if (this.isTrial()) {
      return this._sendBlocked() || this.balanceChf() <= 0;
    }
    return false;
  });

  // A trial that can no longer send — drives the "used up" badge/messaging.
  readonly isTrialUsedUp = computed(() => this.isTrial() && this.isSendingLocked());

  // A paid plan whose last renewal payment failed — Paddle is dunning. Access
  // continues through the grace window; we surface a banner to fix the card.
  readonly isPastDue = computed(() => this._state()?.status === 'past_due');

  constructor() {
    this.refresh();

    // The Paddle.js overlay completes in-page (no redirect back), so reuse the
    // activation poll the moment checkout completes.
    this._paddle.checkoutCompleted$.pipe(takeUntilDestroyed()).subscribe(() => {
      // Trial→paid conversion, attributed to the last-started plan. Paddle's
      // webhooks stay the revenue source of truth (spec §8).
      this._analytics.track(
        'checkout_completed',
        this._lastCheckoutPlan ? { plan: this._lastCheckoutPlan } : undefined,
      );
      this.pollActivation();
    });
  }

  readonly checkoutPending = this._checkoutPending.asReadonly();
  // True while we wait for the subscription webhook to flip us to a paid plan.
  readonly activating = this._activating.asReadonly();
  // True once the poll gives up — the plan may still be settling server-side.
  readonly activationSlow = this._activationSlow.asReadonly();

  // fetchState fetches the authoritative plan state and syncs the signal. The
  // activation poll subscribes to this; `refresh` is the fire-and-forget form.
  fetchState(): Observable<BillingApiResponse> {
    return this._api.getBilling().pipe(
      tap((res) => {
        this._state.set({
          planType: res.plan_type,
          status: res.status,
          balanceChf: res.balance_chf ?? 0,
          trialSeedChf: res.trial_seed_chf ?? 0,
          paygMinCommitChf: res.payg_min_commit_chf,
        });
        // PAYG cost lives in the usage ledger, not the plan state, so keep the
        // sidebar's monthly total in step with every state refresh (including
        // the post-completion reconcile).
        if (res.plan_type === 'payg') {
          this._refreshPaygUsage();
        }
      }),
    );
  }

  // _refreshPaygUsage re-fetches this cycle's metered usage total. Failures
  // leave the last known figure — the card is informational, never a gate.
  private _refreshPaygUsage(): void {
    this._api.getBillingUsage().subscribe({
      next: (usage) =>
        this._paygUsageChf.set(
          usage.by_model.reduce((sum, row) => sum + row.cost_chf, 0),
        ),
      error: () => {
        /* keep the previous total */
      },
    });
  }

  // refresh re-fetches the authoritative plan state. Failures (e.g. not yet
  // authenticated) leave the last known state untouched.
  refresh(): void {
    this.fetchState().subscribe({
      error: () => {
        /* leave state as-is; the gate still relies on the 402 from /complete */
      },
    });
  }

  // beginCheckout creates a Paddle transaction for the plan, then opens the
  // Paddle.js overlay for it. When the overlay isn't configured we fall back to
  // a full redirect to the hosted checkout; Paddle returns the user to the
  // pricing page with ?status=activating so the poll can take over.
  beginCheckout(plan: CheckoutPlan, entry: CheckoutEntry): void {
    if (this._checkoutPending()) {
      return;
    }
    this._checkoutPending.set(true);

    // Which prompt converts + plan preference. Fired on intent, before the
    // transaction is created, so abandoned starts are visible too.
    this._lastCheckoutPlan = checkoutPlanProp(plan);
    this._analytics.track('checkout_started', {
      plan: this._lastCheckoutPlan,
      entry,
    });

    const origin = this._document.location.origin;
    this._api
      .createCheckout({
        plan,
        returnUrl: `${origin}/pricing?status=activating`,
      })
      .subscribe({
        next: (res) => {
          void this._launchCheckout(res);
        },
        error: () => {
          this._checkoutPending.set(false);
          this._errors.alert(this._transloco.translate('errors.startCheckout'));
        },
      });
  }

  // _launchCheckout prefers the in-page Paddle overlay (no navigation); on
  // completion the constructor's subscription starts the activation poll. If the
  // overlay can't open it falls back to the hosted checkout page.
  private async _launchCheckout(res: CheckoutResponse): Promise<void> {
    if (res.transaction_id && this._paddle.enabled) {
      const opened = await this._paddle.openCheckout(
        res.transaction_id,
        this._auth.email(),
        paddleLocaleFor(this._language.current()),
      );
      if (opened) {
        this._checkoutPending.set(false);
        return;
      }
    }
    this._document.location.href = res.checkout_url;
  }

  // changePlan switches the user's existing subscription to another plan. When
  // the backend reports `checkout` (no live subscription — first purchase or
  // resubscribe) it falls back to the Paddle overlay/hosted checkout, mirroring
  // beginCheckout. Otherwise it refreshes the authoritative state. The Observable
  // lets the dashboard react (close the picker, reload) once the call resolves.
  changePlan(plan: CheckoutPlan): Observable<ChangePlanResponse> {
    const origin = this._document.location.origin;
    return this._api
      .changePlan({ plan, returnUrl: `${origin}/account/billing?status=activating` })
      .pipe(
        tap((res) => {
          if (res.status === 'checkout' && res.checkout_url) {
            // No live subscription — this is a fresh checkout started from the
            // billing settings surface.
            this._lastCheckoutPlan = checkoutPlanProp(plan);
            this._analytics.track('checkout_started', {
              plan: this._lastCheckoutPlan,
              entry: 'billing',
            });
            void this._launchCheckout({
              transaction_id: res.transaction_id,
              checkout_url: res.checkout_url,
            });
          } else {
            if (res.status === 'changed') {
              // Up/downgrade pattern; both values are closed plan enums.
              this._analytics.track('plan_changed', {
                from: this.planType() ?? 'unknown',
                to: checkoutPlanProp(plan),
              });
            }
            this.refresh();
          }
        }),
      );
  }

  // openPortal opens an authenticated Paddle customer-portal link in a new tab.
  // The tab is opened synchronously (within the click) to dodge pop-up blockers,
  // then pointed at the link once the backend mints it. 'payment' deep-links to
  // the card form when available.
  openPortal(target: 'overview' | 'payment' = 'overview'): void {
    // Self-serve billing health.
    this._analytics.track('billing_portal_opened');

    const view = this._document.defaultView;
    const tab = view?.open('about:blank', '_blank') ?? null;
    if (tab) {
      tab.opener = null;
    }

    this._api.createPortalSession().subscribe({
      next: (res) => {
        const url =
          target === 'payment' && res.update_payment_url
            ? res.update_payment_url
            : res.overview_url;
        if (tab) {
          tab.location.href = url;
        } else {
          view?.open(url, '_blank');
        }
      },
      error: () => {
        tab?.close();
        this._errors.alert(this._transloco.translate('errors.openPortal'));
      },
    });
  }

  // openInvoicePdf opens a Paddle PDF invoice in a new tab. Like openPortal, the
  // tab is opened synchronously (within the click) to dodge pop-up blockers, then
  // pointed at the short-lived URL the backend mints (ownership-checked server-side).
  openInvoicePdf(transactionId: string): void {
    const view = this._document.defaultView;
    const tab = view?.open('about:blank', '_blank') ?? null;
    if (tab) {
      tab.opener = null;
    }

    this._api.getInvoicePdf(transactionId).subscribe({
      next: (res) => {
        if (tab) {
          tab.location.href = res.url;
        } else {
          view?.open(res.url, '_blank');
        }
      },
      error: () => {
        tab?.close();
        this._errors.alert(this._transloco.translate('errors.openInvoice'));
      },
    });
  }

  // pollActivation waits for the subscription webhook to flip the plan to a paid
  // tier, then drops the user back into chat. Reused by the pricing page (after
  // a hosted-checkout redirect) and by overlay completion. Concurrent calls are
  // ignored so the two paths never double-poll.
  pollActivation(): void {
    if (this._activating()) {
      return;
    }
    this._activating.set(true);
    this._activationSlow.set(false);

    timer(0, ACTIVATION_POLL_INTERVAL_MS)
      .pipe(
        take(ACTIVATION_POLL_MAX_ATTEMPTS),
        switchMap(() => this.fetchState()),
        // Stop the moment a paid plan lands (inclusive: still emit that state so
        // `next` can route once). Without this the timer kept firing and
        // re-navigated to '/' every interval, yanking the user off any page.
        takeWhile((state) => !this._isPaidPlan(state), true),
      )
      .subscribe({
        next: (state) => {
          if (this._isPaidPlan(state)) {
            this._activating.set(false);
            void this._router.navigate(['/']);
          }
        },
        complete: () => {
          if (this._activating()) {
            this._activationSlow.set(true);
          }
        },
      });
  }

  private _isPaidPlan(state: BillingApiResponse): boolean {
    return state.plan_type === 'payg' || state.plan_type === 'unlimited';
  }

  // applyTrialUsage optimistically reduces the displayed trial credit so the
  // pill tracks spend between refreshes. No-op for non-trial plans.
  applyTrialUsage(costChf: number): void {
    const current = this._state();
    if (!current || current.planType !== 'trial' || costChf <= 0) {
      return;
    }
    this._state.set({
      ...current,
      balanceChf: Math.max(0, current.balanceChf - costChf),
    });
  }

  // markSendingBlocked records a billing 402 from /complete so the locked-chat
  // surfaces appear immediately, and reflects an inactive plan locally.
  markSendingBlocked(restriction: CompletionBillingRestriction): void {
    this._sendBlocked.set(true);
    // The server 402 with TRIAL_EXHAUSTED is the authoritative "trial used up"
    // signal (a used-up trial keeps a near-zero, not exactly zero, balance).
    if (restriction.code === 'TRIAL_EXHAUSTED' && !this._trialExhaustedTracked) {
      this._trialExhaustedTracked = true;
      this._analytics.track('trial_exhausted');
    }
    if (restriction.code === 'INACTIVE') {
      const current = this._state();
      this._state.set({
        planType: 'inactive',
        balanceChf: 0,
        trialSeedChf: current?.trialSeedChf ?? 0,
      });
    }
  }

  // markOrgSendingBlocked records an org billing 402 from /complete so the
  // in-conversation banner appears for that Organisation's Projects. It NEVER
  // touches the personal plan state or the personal send lock — the personal
  // workspace keeps working (persona PER-006 friction #2).
  markOrgSendingBlocked(restriction: OrgCompletionBillingRestriction): void {
    this._orgSendBlock.set(restriction);
  }

  /**
   * applyOrgBillingRestriction parses a write-path 402 and records an org
   * billing block when recognised. Returns true when the error was handled.
   */
  applyOrgBillingRestriction(error: unknown): boolean {
    const restriction = parseOrgBillingRestriction(error);
    if (!restriction) {
      return false;
    }
    this.markOrgSendingBlocked(restriction);
    return true;
  }

  // clearOrgSendingBlocked drops the org billing block once a completion for
  // that Organisation succeeds again (billing was restored). Passing an org id
  // only clears a block belonging to that Organisation, so a successful send
  // in another context never hides a still-active block.
  clearOrgSendingBlocked(organisationId?: string): void {
    const current = this._orgSendBlock();
    if (!current) {
      return;
    }
    if (organisationId !== undefined && current.organisationId !== organisationId) {
      return;
    }
    this._orgSendBlock.set(null);
  }
}
