import { signal } from '@angular/core';

import { OrgCompletionBillingRestriction } from '@app/interfaces/billing';
import { OrgBillingContextService } from '@app/services/org-billing-context.service';

export type OrgBillingContextStubOptions = {
  blocked?: boolean;
  block?: OrgCompletionBillingRestriction | null;
  billingLoading?: boolean;
};

/** Build a configurable org billing context stub for component specs. */
export const buildOrgBillingContextStub = (
  options: OrgBillingContextStubOptions = {},
) => ({
  provide: OrgBillingContextService,
  useValue: {
    activeOrgBillingBlock: signal(options.block ?? null),
    orgWorkspaceWritesBlocked: signal(options.blocked ?? false),
    activeOrgBillingBlocked: signal(options.blocked ?? false),
    billingLoading: signal(options.billingLoading ?? false),
    refreshActiveOrgBilling: () => undefined,
  },
});

/** Default org billing context stub — writes allowed, no banner. */
export const stubOrgBillingContext = buildOrgBillingContextStub();
