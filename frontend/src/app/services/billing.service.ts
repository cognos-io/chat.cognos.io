import { DOCUMENT } from '@angular/common';
import { Injectable, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';

import { Observable, switchMap, take, takeWhile, tap, timer } from 'rxjs';

import {
  BillingApiResponse,
  BillingState,
  ChangePlanResponse,
  CheckoutPlan,
  CheckoutResponse,
  CompletionBillingRestriction,
} from '@app/interfaces/billing';
import { AuthService } from '@app/services/auth.service';
import { CognosApiService } from '@app/services/cognos-api.service';
import { ErrorService } from '@app/services/error.service';
import { PaddleService } from '@app/services/paddle.service';

// How long to wait for the subscription.created webhook before telling the user
// it's taking longer than usual. ~100s at a cache-warm 2.5s cadence.
const ACTIVATION_POLL_INTERVAL_MS = 2500;
const ACTIVATION_POLL_MAX_ATTEMPTS = 40;

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

  private readonly _state = signal<BillingState | null>(null);
  private readonly _checkoutPending = signal(false);
  private readonly _activating = signal(false);
  private readonly _activationSlow = signal(false);

  // Set when a /complete call is rejected for billing reasons this session.
  // A used-up trial keeps plan_type='trial' with a near-zero (but not always
  // exactly zero) balance, so the server 402 is the most reliable "you can no
  // longer send" signal mid-session.
  private readonly _sendBlocked = signal(false);

  readonly state = this._state.asReadonly();
  readonly planType = computed(() => this._state()?.planType ?? null);
  readonly balanceChf = computed(() => this._state()?.balanceChf ?? 0);
  readonly trialSeedChf = computed(() => this._state()?.trialSeedChf ?? 0);
  readonly isTrial = computed(() => this.planType() === 'trial');

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
    this._paddle.checkoutCompleted$
      .pipe(takeUntilDestroyed())
      .subscribe(() => this.pollActivation());
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
      tap((res) =>
        this._state.set({
          planType: res.plan_type,
          status: res.status,
          balanceChf: res.balance_chf ?? 0,
          trialSeedChf: res.trial_seed_chf ?? 0,
        }),
      ),
    );
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
  beginCheckout(plan: CheckoutPlan): void {
    if (this._checkoutPending()) {
      return;
    }
    this._checkoutPending.set(true);

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
          this._errors.alert('Could not start checkout. Please try again.');
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
            void this._launchCheckout({
              transaction_id: res.transaction_id,
              checkout_url: res.checkout_url,
            });
          } else {
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
        this._errors.alert('Could not open the billing portal. Please try again.');
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
    if (restriction.code === 'INACTIVE') {
      const current = this._state();
      this._state.set({
        planType: 'inactive',
        balanceChf: 0,
        trialSeedChf: current?.trialSeedChf ?? 0,
      });
    }
  }
}
