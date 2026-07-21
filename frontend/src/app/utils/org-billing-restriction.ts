import { HttpErrorResponse } from '@angular/common/http';

import { OrgCompletionBillingRestriction } from '@app/interfaces/billing';

type OrgRestrictionBody = {
  error?: string;
  organisation_id?: string;
  organisation_name?: string;
  message?: string;
  admin_message?: string;
};

/**
 * parseOrgBillingRestriction recognises the structured 402 returned when an
 * org-owned write is blocked by the Organisation's billing (fail closed —
 * docs/business_processes/organisation-lifecycle.md). Used by completions, project creation,
 * and any other content-write gate that shares the same public 402 contract.
 */
export const parseOrgBillingRestriction = (
  error: unknown,
): OrgCompletionBillingRestriction | null => {
  if (!(error instanceof HttpErrorResponse) || error.status !== 402) {
    return null;
  }
  const response = error.error as
    (OrgRestrictionBody & { data?: OrgRestrictionBody }) | null;
  // Completion billing can be rejected by either the completion handler
  // (direct JSON) or the central content-write gate (PocketBase ApiError,
  // whose structured fields live under `data`). Both are the same public 402
  // contract and must drive the same calm banner.
  const body = response?.data ?? response;
  const code = body?.error;
  if (code !== 'ORG_BILLING_INACTIVE' && code !== 'ORG_BILLING_PAST_DUE') {
    return null;
  }
  return {
    code,
    organisationId: body?.organisation_id ?? '',
    organisationName: body?.organisation_name ?? '',
    message: body?.message ?? response?.message ?? '',
    adminMessage: body?.admin_message ?? '',
  };
};

/** @deprecated Use parseOrgBillingRestriction — kept for existing imports. */
export const parseOrgCompletionBillingRestriction = parseOrgBillingRestriction;
