import { Dialog } from '@angular/cdk/dialog';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';

import {
  PlanGateDialogComponent,
  PlanGateDialogData,
} from '@app/components/billing/plan-gate-dialog/plan-gate-dialog.component';
import {
  BillingPlanType,
  BillingState,
  CompletionBillingRestriction,
  PlanGateReason,
} from '@app/interfaces/billing';
import { CognosApiService } from '@app/services/cognos-api.service';
import { cognosDialogOptions } from '@app/utils/dialog-options';

// BillingService is the frontend's single source of truth for the user's plan
// state. It backs the trial pill, the read-only composer lock, and the
// plan-gate dialog. The balance is shown to the user but is never authoritative
// — the backend ledger is. We optimistically decrement it as completions land
// so the pill feels live, then reconcile on the next refresh.
@Injectable({
  providedIn: 'root',
})
export class BillingService {
  private readonly _api = inject(CognosApiService);
  private readonly _dialog = inject(Dialog);
  private readonly _router = inject(Router);

  private readonly _state = signal<BillingState | null>(null);
  private _gateOpen = false;

  readonly state = this._state.asReadonly();
  readonly planType = computed(() => this._state()?.planType ?? null);
  readonly balanceChf = computed(() => this._state()?.balanceChf ?? 0);
  readonly isTrial = computed(() => this.planType() === 'trial');
  readonly isReadOnly = computed(() => this.planType() === 'inactive');

  constructor() {
    this.refresh();
  }

  // refresh re-fetches the authoritative plan state. Failures (e.g. not yet
  // authenticated) leave the last known state untouched.
  refresh(): void {
    this._api.getBilling().subscribe({
      next: (res) =>
        this._state.set({
          planType: res.plan_type,
          balanceChf: res.balance_chf ?? 0,
        }),
      error: () => {
        /* leave state as-is; the gate still relies on the 402 from /complete */
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

  // presentPlanGate is called when /complete returns a billing 402. It syncs
  // the local state to the server's verdict (so the composer locks for
  // inactive) and opens the plan-selection dialog.
  presentPlanGate(restriction: CompletionBillingRestriction): void {
    if (restriction.code === 'INACTIVE') {
      this._state.set({ planType: 'inactive', balanceChf: 0 });
      this.openPlanGate('inactive');
      return;
    }
    this.refresh();
    this.openPlanGate('trial_exhausted');
  }

  // openPlanGate shows the dialog (at most one at a time). Choosing a plan
  // routes to the billing page with the chosen plan pre-selected.
  openPlanGate(reason: PlanGateReason): void {
    if (this._gateOpen) {
      return;
    }
    this._gateOpen = true;
    const ref = this._dialog.open<BillingPlanType | undefined>(
      PlanGateDialogComponent,
      {
        ...cognosDialogOptions,
        data: { reason } satisfies PlanGateDialogData,
      },
    );
    ref.closed.subscribe((plan) => {
      this._gateOpen = false;
      if (plan) {
        void this._router.navigate(['/account/billing'], { queryParams: { plan } });
      }
    });
  }
}
