import { OrgBillingRecord } from '@app/interfaces/organisation';

// Pure display logic for the pooled-overage panel (spec §5.6/§5.7). The
// server's projected_overage_rappen is authoritative for the amount — these
// helpers only derive presentation state from the billing record, so an Owner
// sees the overage coming BEFORE cycle close, never as an invoice surprise.

export type OverageState = 'under' | 'at' | 'over';

export interface OverageDisplay {
  state: OverageState;
  /** Projected overage at cycle close, in rappen (never negative). */
  overageRappen: number;
  /** Headroom left under the pooled floor, in rappen (never negative). */
  remainingRappen: number;
  /** Usage as a share of the floor for the progress bar, capped at 100. */
  progressPercent: number;
}

type OverageInputs = Pick<
  OrgBillingRecord,
  'floor_rappen' | 'pooled_usage_rappen' | 'projected_overage_rappen'
>;

export function overageDisplay(billing: OverageInputs): OverageDisplay {
  const floor = Math.max(0, billing.floor_rappen);
  const usage = Math.max(0, billing.pooled_usage_rappen);
  const overageRappen = Math.max(0, billing.projected_overage_rappen);

  const state: OverageState =
    overageRappen > 0 ? 'over' : usage >= floor && usage > 0 ? 'at' : 'under';

  return {
    state,
    overageRappen,
    remainingRappen: Math.max(0, floor - usage),
    // A zero floor (no billed seats — should not occur while active) counts
    // as fully used rather than dividing by zero.
    progressPercent:
      floor > 0
        ? Math.min(100, Math.round((usage / floor) * 100))
        : usage > 0
          ? 100
          : 0,
  };
}
