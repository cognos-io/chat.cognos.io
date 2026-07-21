export const BILLING_PRICES = {
  paygMinimum: 'CHF 15',
  // Organisation Seat price (docs/business_processes/organisation-lifecycle.md) — CHF 15
  // per Seat per month, minimum three Seats (CHF 45 floor), pooled usage.
  orgSeatMonthly: 'CHF 15',
  orgSeatMinimum: 3,
  orgSeatMinimumFloor: 'CHF 45',
  unlimitedMonthly: 'CHF 150',
  unlimitedAnnual: "CHF 1'500",
  unlimitedAnnualSaving: 'CHF 300',
} as const;
