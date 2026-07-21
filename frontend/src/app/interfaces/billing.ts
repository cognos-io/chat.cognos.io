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

// ChangePlanRequest switches an existing subscription to a different plan
// (`POST /api/v1/billing/change-plan`). Distinct from checkout: it modifies the
// one subscription rather than creating a new one.
export interface ChangePlanRequest {
  plan: CheckoutPlan;
  returnUrl?: string;
}

// ChangePlanResponse reports the outcome. `changed`/`unchanged` mean the
// subscription was modified in place; `checkout` means the user had no live
// subscription and must complete a hosted/overlay checkout (`checkout_url` /
// `transaction_id` populated, as for CheckoutResponse).
export interface ChangePlanResponse {
  status: 'changed' | 'unchanged' | 'checkout';
  checkout_url?: string;
  transaction_id?: string;
}

// PortalResponse is the `POST /api/v1/billing/portal` payload: authenticated
// Paddle customer-portal links to open in a new tab (never stored).
export interface PortalResponse {
  overview_url: string;
  update_payment_url?: string;
}

// PaymentCard is the saved-card summary (display fields only — never a full
// card number). Sourced from Paddle's customer payment methods.
export interface PaymentCard {
  brand: string;
  last4: string;
  expiry_month: number;
  expiry_year: number;
}

// Invoice is a single Paddle transaction surfaced on the dashboard.
export interface Invoice {
  id: string;
  invoice_number: string;
  description?: string; // e.g. "Unlimited · monthly"
  status: string; // paid, completed, billed, past_due, canceled, refunded
  currency: string;
  amount_minor: number; // minor units (Rappen for CHF)
  billed_at?: string;
}

// InvoicePdfResponse is the `GET /api/v1/billing/invoices/{id}/pdf` payload — a
// short-lived URL to the PDF (never cached).
export interface InvoicePdfResponse {
  url: string;
}

// BillingInvoicesResponse is the `GET /api/v1/billing/invoices` payload.
export interface BillingInvoicesResponse {
  card: PaymentCard | null;
  invoices: Invoice[];
}

export type BillingStatus =
  'trial' | 'active' | 'cancels_soon' | 'past_due' | 'inactive';

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
  // The PAYG monthly minimum (server-configured, matches the Paddle price).
  // Present on every response so no surface has to hardcode the amount.
  payg_min_commit_chf?: number;
}

// BillingState is the normalised view the frontend holds in a signal.
export interface BillingState {
  planType: BillingPlanType;
  status?: BillingStatus;
  balanceChf: number;
  trialSeedChf: number;
  paygMinCommitChf?: number;
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
// endpoint returns when billing blocks a send (spec).
export interface CompletionBillingRestriction {
  code: 'TRIAL_EXHAUSTED' | 'INACTIVE';
  message: string;
  balanceChf?: number;
  estimatedCostChf?: number;
  nextStep?: string;
}

// The two organisation billing gates a completion in an org-owned Project can
// hit (fail closed, docs/business_processes/organisation-lifecycle.md). Both mean the whole
// Organisation is paused — never the member's fault, and never falls back to
// the member's personal balance.
export type OrgBillingRestrictionCode = 'ORG_BILLING_INACTIVE' | 'ORG_BILLING_PAST_DUE';

/**
 * OrgCompletionBillingRestriction is the structured 402 body for a completion
 * blocked by the owning Organisation's billing. `message` is the neutral
 * member copy; `adminMessage` is the one actionable step for Owners/Admins.
 * The viewer's role decides which the UI leads with.
 */
export interface OrgCompletionBillingRestriction {
  code: OrgBillingRestrictionCode;
  organisationId: string;
  organisationName: string;
  message: string;
  adminMessage: string;
}
