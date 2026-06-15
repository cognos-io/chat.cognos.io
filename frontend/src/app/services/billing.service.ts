import { DOCUMENT } from '@angular/common';
import { Injectable, computed, inject, signal } from '@angular/core';

import { Observable, tap } from 'rxjs';

import {
  BillingApiResponse,
  BillingState,
  CheckoutPlan,
  CompletionBillingRestriction,
} from '@app/interfaces/billing';
import { CognosApiService } from '@app/services/cognos-api.service';
import { ErrorService } from '@app/services/error.service';

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

  private readonly _state = signal<BillingState | null>(null);
  private readonly _checkoutPending = signal(false);

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

  constructor() {
    this.refresh();
  }

  readonly checkoutPending = this._checkoutPending.asReadonly();

  // fetchState fetches the authoritative plan state and syncs the signal. The
  // activation poll subscribes to this; `refresh` is the fire-and-forget form.
  fetchState(): Observable<BillingApiResponse> {
    return this._api.getBilling().pipe(
      tap((res) =>
        this._state.set({
          planType: res.plan_type,
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

  // beginCheckout creates a Paddle checkout for the plan and redirects the
  // browser to it. Paddle returns the user to the pricing page with
  // ?status=activating so the activation poll can take over.
  beginCheckout(plan: CheckoutPlan): void {
    if (this._checkoutPending()) {
      return;
    }
    this._checkoutPending.set(true);

    const origin = this._document.location.origin;
    this._api
      .createCheckout({
        plan,
        returnUrl: `${origin}/account/billing?status=activating`,
      })
      .subscribe({
        next: ({ checkout_url }) => {
          this._document.location.href = checkout_url;
        },
        error: () => {
          this._checkoutPending.set(false);
          this._errors.alert('Could not start checkout. Please try again.');
        },
      });
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
