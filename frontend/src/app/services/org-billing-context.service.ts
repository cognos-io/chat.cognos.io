import {
  DestroyRef,
  Injectable,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { OrgCompletionBillingRestriction } from '@app/interfaces/billing';
import { OrgBillingRecord } from '@app/interfaces/organisation';
import { BillingService } from '@app/services/billing.service';
import { CognosApiService } from '@app/services/cognos-api.service';
import { OrganisationService } from '@app/services/organisation.service';
import { orgBlockAppliesToActiveWorkspace } from '@app/utils/org-billing-block';

/**
 * OrgBillingContextService caches the active Organisation's billing status for
 * owners/admins and combines it with reactive 402 blocks so write surfaces can
 * gate affordances before and after a failed API call.
 */
@Injectable({
  providedIn: 'root',
})
export class OrgBillingContextService {
  private readonly _api = inject(CognosApiService);
  private readonly _workspaces = inject(OrganisationService);
  private readonly _billing = inject(BillingService);
  private readonly _destroyRef = inject(DestroyRef);

  private readonly _activeBilling = signal<OrgBillingRecord | null>(null);
  private readonly _billingLoading = signal(false);

  /** True when owner/admin billing fetch shows inactive or past_due. */
  readonly activeOrgBillingBlocked = computed(() => {
    const billing = this._activeBilling();
    if (!billing) {
      return false;
    }
    return billing.plan_type === 'inactive' || billing.past_due;
  });

  readonly billingLoading = this._billingLoading.asReadonly();

  /** True when org writes should be blocked in the active Workspace. */
  readonly orgWorkspaceWritesBlocked = computed(
    () =>
      this.activeOrgBillingBlocked() ||
      orgBlockAppliesToActiveWorkspace(
        this._billing.orgSendBlock(),
        this._workspaces.activeWorkspace(),
      ),
  );

  /**
   * The org billing restriction to show in the active Workspace — from a
   * reactive 402 when present, otherwise synthesised from cached billing.
   */
  readonly activeOrgBillingBlock = computed(
    (): OrgCompletionBillingRestriction | null => {
      const workspace = this._workspaces.activeWorkspace();
      const reactive = this._billing.orgSendBlock();
      if (orgBlockAppliesToActiveWorkspace(reactive, workspace)) {
        return reactive;
      }
      if (!this._workspaces.isOrgWorkspace() || !this.activeOrgBillingBlocked()) {
        return null;
      }
      const org = this._workspaces.activeOrg();
      if (!org) {
        return null;
      }
      const billing = this._activeBilling();
      return {
        code: billing?.past_due ? 'ORG_BILLING_PAST_DUE' : 'ORG_BILLING_INACTIVE',
        organisationId: org.id,
        organisationName: org.name,
        message: '',
        adminMessage: '',
      };
    },
  );

  constructor() {
    effect(() => {
      const org = this._workspaces.activeOrg();
      if (!org || (org.role !== 'owner' && org.role !== 'admin')) {
        this._activeBilling.set(null);
        this._billingLoading.set(false);
        return;
      }
      this.loadBilling(org.id);
    });
  }

  /** Re-fetch billing for the active org (e.g. after returning from checkout). */
  refreshActiveOrgBilling(): void {
    const org = this._workspaces.activeOrg();
    if (!org || (org.role !== 'owner' && org.role !== 'admin')) {
      return;
    }
    this.loadBilling(org.id);
  }

  private loadBilling(orgId: string): void {
    this._billingLoading.set(true);
    this._api
      .getOrgBilling(orgId)
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({
        next: (billing) => {
          this._activeBilling.set(billing);
          this._billingLoading.set(false);
          if (billing.plan_type === 'payg' && !billing.past_due) {
            this._billing.clearOrgSendingBlocked(orgId);
          }
        },
        error: () => {
          this._activeBilling.set(null);
          this._billingLoading.set(false);
        },
      });
  }
}
