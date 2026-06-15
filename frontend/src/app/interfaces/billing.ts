// Billing types shared across the chat shell, the plan-gate dialog and the
// account pages. The wire shape (`*_chf`, snake_case) mirrors the backend
// contract in backend/internal/handler/billing.go; the camelCase view models
// are what the Angular layer works with.

export type BillingPlanType = 'trial' | 'payg' | 'unlimited' | 'inactive';

// BillingApiResponse is the raw `GET /api/v1/billing` payload.
export interface BillingApiResponse {
  plan_type: BillingPlanType;
  balance_chf: number;
}

// BillingState is the normalised view the frontend holds in a signal.
export interface BillingState {
  planType: BillingPlanType;
  balanceChf: number;
}

// Why the user hit the plan gate — drives the dialog's copy.
export type PlanGateReason = 'trial_exhausted' | 'inactive';

// CompletionBillingRestriction is the structured 402 body the `/complete`
// endpoint returns when billing blocks a send (spec §12.7).
export interface CompletionBillingRestriction {
  code: 'TRIAL_EXHAUSTED' | 'INACTIVE';
  message: string;
  balanceChf?: number;
  estimatedCostChf?: number;
  nextStep?: string;
}
