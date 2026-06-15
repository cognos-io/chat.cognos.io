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
  // Paddle transaction id for the Paddle.js overlay; checkout_url is the
  // hosted-page fallback when the overlay can't be used.
  transaction_id?: string;
  checkout_url: string;
}

// PortalResponse is the `POST /api/v1/billing/portal` payload: authenticated
// Paddle customer-portal links to open in a new tab (never stored).
export interface PortalResponse {
  overview_url: string;
  update_payment_url?: string;
}

export type BillingStatus = 'trial' | 'active' | 'cancels_soon' | 'inactive';

// BillingApiResponse is the raw `GET /api/v1/billing` payload.
export interface BillingApiResponse {
  plan_type: BillingPlanType;
  status: BillingStatus;
  interval?: 'monthly' | 'annual';
  balance_chf: number;
  trial_seed_chf: number;
  cycle_end_at?: string;
  cancel_at_period_end?: boolean;
  refund_eligible_until_at?: string;
  previous_plan_type?: BillingPlanType;
}

// BillingState is the normalised view the frontend holds in a signal.
export interface BillingState {
  planType: BillingPlanType;
  balanceChf: number;
  trialSeedChf: number;
}

// Per-model usage rollup from `GET /api/v1/billing/usage` (ledger metadata
// only — never message content).
export interface UsageModel {
  model_id: string;
  count: number;
  cost_chf: number;
}

export interface UsageResponse {
  period_start: string;
  message_count: number;
  by_model: UsageModel[];
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
