export const BILLING_PRICES = {
  paygMinimum: 'CHF 15',
  // Organisation Seat price (spec: docs/specs/organisations.md §5.7) — CHF 15
  // per Seat per month, minimum three Seats (CHF 45 floor), pooled usage.
  orgSeatMonthly: 'CHF 15',
  orgSeatMinimum: 3,
  orgSeatMinimumFloor: 'CHF 45',
  unlimitedMonthly: 'CHF 150',
  unlimitedAnnual: "CHF 1'500",
  unlimitedAnnualSaving: 'CHF 300',
} as const;
