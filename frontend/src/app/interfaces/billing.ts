// Billing types shared across the chat shell, the plan-gate dialog and the
// account pages. The wire shape (`*_chf`, snake_case) mirrors the backend
// contract in backend/internal/handler/billing.go; the camelCase view models
// are what the Angular layer works with.

export type BillingPlanType = 'trial' | 'payg' | 'unlimited' | 'inactive';

// The purchasable plan keys the checkout endpoint accepts (distinct from the
// active-plan enum above — Unlimited has two billing intervals).
export type CheckoutPlan = 'payg' | 'unlimited_monthly' | 'unlimited_annual';

export interface CheckoutBusiness {
  name: string;
  vat_id: string;
  country: string;
}

export interface CheckoutRequest {
  plan: CheckoutPlan;
  business?: CheckoutBusiness;
  returnUrl?: string;
}

export interface CheckoutResponse {
  checkout_url: string;
}

// BillingApiResponse is the raw `GET /api/v1/billing` payload.
export interface BillingApiResponse {
  plan_type: BillingPlanType;
  balance_chf: number;
  trial_seed_chf: number;
}

// BillingState is the normalised view the frontend holds in a signal.
export interface BillingState {
  planType: BillingPlanType;
  balanceChf: number;
  trialSeedChf: number;
}

// CompletionBillingRestriction is the structured 402 body the `/complete`
// endpoint returns when billing blocks a send (spec §12.7).
export interface CompletionBillingRestriction {
  code: 'TRIAL_EXHAUSTED' | 'INACTIVE';
  message: string;
  balanceChf?: number;
  estimatedCostChf?: number;
  nextStep?: string;
}
