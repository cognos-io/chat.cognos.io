import { TestBed } from '@angular/core/testing';

import { of, throwError } from 'rxjs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OrgBillingRecord, OrganisationRecord } from '@app/interfaces/organisation';

import { BillingService } from './billing.service';
import { CognosApiService } from './cognos-api.service';
import { OrgBillingContextService } from './org-billing-context.service';
import { OrganisationService } from './organisation.service';

const acme: OrganisationRecord = {
  id: 'org_acme',
  name: 'Acme',
  role: 'owner',
  created: '2026-01-01T00:00:00.000Z',
  policy_privacy_tier: '',
  policy_retention_days: 0,
  policy_mfa_required: false,
};

const inactiveBilling: OrgBillingRecord = {
  plan_type: 'inactive',
  past_due: false,
  seat_quantity: 0,
  pending_seat_quantity: 0,
  cycle_start_at: '',
  cycle_end_at: '',
  floor_rappen: 0,
  pooled_usage_rappen: 0,
  projected_overage_rappen: 0,
};

const activeBilling: OrgBillingRecord = {
  ...inactiveBilling,
  plan_type: 'payg',
  seat_quantity: 1,
  floor_rappen: 1500,
};

const pastDueBilling: OrgBillingRecord = {
  ...activeBilling,
  past_due: true,
};

describe('OrgBillingContextService', () => {
  let activeWorkspace: ReturnType<typeof vi.fn<() => string>>;
  let activeOrg: ReturnType<typeof vi.fn<() => OrganisationRecord | null>>;
  let orgSendBlock: ReturnType<
    typeof vi.fn<() => ReturnType<BillingService['orgSendBlock']>>
  >;
  let clearOrgSendingBlocked: ReturnType<typeof vi.fn>;
  let getOrgBilling: ReturnType<
    typeof vi.fn<(orgId: string) => import('rxjs').Observable<OrgBillingRecord>>
  >;

  beforeEach(() => {
    activeWorkspace = vi.fn(() => 'personal');
    activeOrg = vi.fn((): OrganisationRecord | null => null);
    orgSendBlock = vi.fn(() => null as ReturnType<BillingService['orgSendBlock']>);
    clearOrgSendingBlocked = vi.fn();
    getOrgBilling = vi.fn(() => of(inactiveBilling));
  });

  function setup(): OrgBillingContextService {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        OrgBillingContextService,
        {
          provide: OrganisationService,
          useValue: {
            activeWorkspace,
            activeOrg,
            isOrgWorkspace: () => activeWorkspace() !== 'personal',
          },
        },
        {
          provide: BillingService,
          useValue: {
            orgSendBlock,
            clearOrgSendingBlocked,
          },
        },
        {
          provide: CognosApiService,
          useValue: { getOrgBilling },
        },
      ],
    });
    return TestBed.inject(OrgBillingContextService);
  }

  it('blocks org writes when owner billing is inactive (sunny)', async () => {
    activeWorkspace.mockReturnValue('org_acme');
    activeOrg.mockReturnValue(acme);
    const service = setup();

    await vi.waitFor(() => {
      expect(service.activeOrgBillingBlocked()).toBe(true);
    });
    expect(service.orgWorkspaceWritesBlocked()).toBe(true);
    expect(service.activeOrgBillingBlock()?.code).toBe('ORG_BILLING_INACTIVE');
    expect(getOrgBilling).toHaveBeenCalledWith('org_acme');
  });

  it('blocks org writes when admin billing is past_due (rainy)', async () => {
    getOrgBilling.mockReturnValue(of(pastDueBilling));
    activeWorkspace.mockReturnValue('org_acme');
    activeOrg.mockReturnValue({ ...acme, role: 'admin' });
    const service = setup();

    await vi.waitFor(() => {
      expect(service.activeOrgBillingBlocked()).toBe(true);
    });
    expect(service.activeOrgBillingBlock()?.code).toBe('ORG_BILLING_PAST_DUE');
  });

  it('does not preemptively block members who cannot read billing (edge)', () => {
    activeWorkspace.mockReturnValue('org_acme');
    activeOrg.mockReturnValue({ ...acme, role: 'member' });
    const service = setup();

    expect(service.activeOrgBillingBlocked()).toBe(false);
    expect(service.orgWorkspaceWritesBlocked()).toBe(false);
    expect(getOrgBilling).not.toHaveBeenCalled();
  });

  it('allows writes when billing is active payg (sunny)', async () => {
    getOrgBilling.mockReturnValue(of(activeBilling));
    activeWorkspace.mockReturnValue('org_acme');
    activeOrg.mockReturnValue(acme);
    const service = setup();

    await vi.waitFor(() => {
      expect(getOrgBilling).toHaveBeenCalledWith('org_acme');
      expect(clearOrgSendingBlocked).toHaveBeenCalledWith('org_acme');
    });
    expect(service.activeOrgBillingBlocked()).toBe(false);
    expect(service.orgWorkspaceWritesBlocked()).toBe(false);
  });

  it('reactively blocks when BillingService holds a matching org 402 (rainy)', () => {
    orgSendBlock.mockReturnValue({
      code: 'ORG_BILLING_PAST_DUE',
      organisationId: 'org_acme',
      organisationName: 'Acme',
      message: 'Paused.',
      adminMessage: 'Fix billing.',
    });
    activeWorkspace.mockReturnValue('org_acme');
    activeOrg.mockReturnValue(acme);
    const service = setup();

    expect(service.orgWorkspaceWritesBlocked()).toBe(true);
    expect(service.activeOrgBillingBlock()?.code).toBe('ORG_BILLING_PAST_DUE');
  });

  it('ignores a reactive block for a different organisation (edge)', () => {
    orgSendBlock.mockReturnValue({
      code: 'ORG_BILLING_INACTIVE',
      organisationId: 'org_other',
      organisationName: 'Other',
      message: '',
      adminMessage: '',
    });
    activeWorkspace.mockReturnValue('org_acme');
    activeOrg.mockReturnValue(acme);
    getOrgBilling.mockReturnValue(of(activeBilling));
    const service = setup();

    expect(service.orgWorkspaceWritesBlocked()).toBe(false);
    expect(service.activeOrgBillingBlock()).toBeNull();
  });

  it('leaves writes allowed when billing fetch fails (rainy)', async () => {
    getOrgBilling.mockReturnValue(throwError(() => new Error('network')));
    activeWorkspace.mockReturnValue('org_acme');
    activeOrg.mockReturnValue(acme);
    const service = setup();

    await vi.waitFor(() => {
      expect(service.billingLoading()).toBe(false);
    });
    expect(service.activeOrgBillingBlocked()).toBe(false);
    expect(service.orgWorkspaceWritesBlocked()).toBe(false);
  });

  it('refreshActiveOrgBilling re-fetches for the active owner org', () => {
    activeWorkspace.mockReturnValue('org_acme');
    activeOrg.mockReturnValue(acme);
    const service = setup();

    getOrgBilling.mockClear();
    service.refreshActiveOrgBilling();

    expect(getOrgBilling).toHaveBeenCalledWith('org_acme');
  });

  it('refreshActiveOrgBilling is a no-op for members', () => {
    activeWorkspace.mockReturnValue('org_acme');
    activeOrg.mockReturnValue({ ...acme, role: 'member' });
    const service = setup();

    getOrgBilling.mockClear();
    service.refreshActiveOrgBilling();

    expect(getOrgBilling).not.toHaveBeenCalled();
  });
});
