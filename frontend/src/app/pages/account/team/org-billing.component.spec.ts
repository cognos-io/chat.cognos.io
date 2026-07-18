import { ComponentFixture, TestBed } from '@angular/core/testing';

import { NEVER, of, throwError } from 'rxjs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  OrgBillingRecord,
  OrgMemberUsageRecord,
  OrgUsageRecord,
  OrganisationRecord,
} from '@app/interfaces/organisation';
import { CognosApiService } from '@app/services/cognos-api.service';
import { ErrorService } from '@app/services/error.service';
import { ModelService } from '@app/services/model.service';

import { OrgBillingComponent } from './org-billing.component';

function makeOrg(role: OrganisationRecord['role']): OrganisationRecord {
  return {
    id: 'org_1',
    name: 'Acme',
    role,
    created: '2026-01-01T00:00:00Z',
    policy_privacy_tier: '',
    policy_retention_days: 0,
    policy_mfa_required: false,
  };
}

function makeBilling(overrides: Partial<OrgBillingRecord> = {}): OrgBillingRecord {
  return {
    plan_type: 'payg',
    past_due: false,
    seat_quantity: 3,
    pending_seat_quantity: 2,
    cycle_start_at: '2026-01-01T00:00:00Z',
    cycle_end_at: '2026-01-31T00:00:00Z',
    floor_rappen: 4500,
    pooled_usage_rappen: 2000,
    projected_overage_rappen: 0,
    ...overrides,
  };
}

function makeUsage(members: OrgMemberUsageRecord[] = []): OrgUsageRecord {
  return {
    cycle_start_at: '2026-01-01T00:00:00Z',
    cycle_end_at: '2026-01-31T00:00:00Z',
    members,
    total_rappen: members.reduce((s, m) => s + m.cost_rappen, 0),
  };
}

function makeMemberUsage(
  overrides: Partial<OrgMemberUsageRecord> = {},
): OrgMemberUsageRecord {
  return {
    user: 'user_1',
    display_name: 'Pat',
    cost_rappen: 500,
    completions: 12,
    top_models: ['gpt-4o'],
    ...overrides,
  };
}

describe('OrgBillingComponent', () => {
  let fixture: ComponentFixture<OrgBillingComponent>;
  let component: OrgBillingComponent;
  let getOrgBilling: ReturnType<typeof vi.fn>;
  let getOrgUsage: ReturnType<typeof vi.fn>;
  let getOrgBillingPortal: ReturnType<typeof vi.fn>;
  let createOrgCheckout: ReturnType<typeof vi.fn>;
  let errorAlert: ReturnType<typeof vi.fn>;

  const modelList = vi.fn(() => [{ id: 'gpt-4o', name: 'GPT-4o' }]);

  async function render(org: OrganisationRecord) {
    await TestBed.configureTestingModule({
      imports: [OrgBillingComponent],
      providers: [
        {
          provide: CognosApiService,
          useValue: {
            getOrgBilling,
            getOrgUsage,
            getOrgBillingPortal,
            createOrgCheckout,
          },
        },
        {
          provide: ModelService,
          useValue: { modelList },
        },
        { provide: ErrorService, useValue: { alert: errorAlert } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(OrgBillingComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('org', org);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    getOrgBilling = vi.fn(() => of(makeBilling()));
    getOrgUsage = vi.fn(() => of(makeUsage()));
    getOrgBillingPortal = vi.fn(() => of({ portal_url: 'https://portal' }));
    createOrgCheckout = vi.fn(() => of({ checkout_url: 'https://checkout' }));
    errorAlert = vi.fn();
  });

  // ---- Loading / error states -----------------------------------------------

  it('shows loading state initially', async () => {
    getOrgBilling = vi.fn(() => NEVER);
    getOrgUsage = vi.fn(() => NEVER);
    await render(makeOrg('owner'));
    expect(fixture.nativeElement.textContent).toContain('Loading…');
  });

  it('shows billing error state when getOrgBilling fails', async () => {
    getOrgBilling = vi.fn(() => throwError(() => new Error('boom')));
    await render(makeOrg('owner'));
    expect(fixture.nativeElement.textContent).toContain(
      'Could not load billing. Please try again.',
    );
  });

  it('shows usage error state when getOrgUsage fails', async () => {
    getOrgUsage = vi.fn(() => throwError(() => new Error('boom')));
    await render(makeOrg('owner'));

    expect(getOrgBilling).toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain(
      'Could not load usage. Please try again.',
    );
  });

  // ---- Past due: role-based actions -----------------------------------------

  it('shows portal button for owner when past_due', async () => {
    getOrgBilling = vi.fn(() => of(makeBilling({ past_due: true })));
    await render(makeOrg('owner'));
    fixture.detectChanges();

    const btn = fixture.nativeElement.querySelector('cog-button');
    expect(btn).not.toBeNull();
    expect(btn.textContent).toContain('Update payment method');
  });

  it('shows ask-owner copy for admin when past_due', async () => {
    getOrgBilling = vi.fn(() => of(makeBilling({ past_due: true })));
    await render(makeOrg('admin'));
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      'Ask an owner or admin to update the payment method.',
    );
    expect(fixture.nativeElement.querySelector('cog-button')).toBeNull();
  });

  // ---- Inactive plan: role-based actions ------------------------------------

  it('shows checkout button for owner when inactive', async () => {
    getOrgBilling = vi.fn(() => of(makeBilling({ plan_type: 'inactive' })));
    await render(makeOrg('owner'));
    fixture.detectChanges();

    const btn = fixture.nativeElement.querySelector('cog-button');
    expect(btn).not.toBeNull();
    expect(btn.textContent).toContain('Add payment method');
  });

  it('shows ask-owner copy for admin when inactive', async () => {
    getOrgBilling = vi.fn(() => of(makeBilling({ plan_type: 'inactive' })));
    await render(makeOrg('admin'));
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      'Ask an owner or admin to add a payment method.',
    );
    expect(fixture.nativeElement.querySelector('cog-button')).toBeNull();
  });

  // ---- Projected overage panel (table-driven) -------------------------------

  const overageCases: {
    name: string;
    billing: Partial<OrgBillingRecord>;
    expectedState: 'under' | 'at' | 'over';
  }[] = [
    {
      name: 'under floor shows headroom',
      billing: {
        floor_rappen: 4500,
        pooled_usage_rappen: 2000,
        projected_overage_rappen: 0,
      },
      expectedState: 'under',
    },
    {
      name: 'at floor shows at callout',
      billing: {
        floor_rappen: 4500,
        pooled_usage_rappen: 4500,
        projected_overage_rappen: 0,
      },
      expectedState: 'at',
    },
    {
      name: 'over floor shows overage warning',
      billing: {
        floor_rappen: 4500,
        pooled_usage_rappen: 5000,
        projected_overage_rappen: 500,
      },
      expectedState: 'over',
    },
  ];

  it.each(overageCases)('$name', async ({ billing, expectedState }) => {
    getOrgBilling = vi.fn(() => of(makeBilling(billing)));
    await render(makeOrg('owner'));
    fixture.detectChanges();

    const panel = fixture.nativeElement.querySelector('[data-testid="org-overage"]');
    expect(panel).not.toBeNull();

    if (expectedState === 'under') {
      expect(panel.textContent).toContain('remaining under the floor');
    } else if (expectedState === 'at') {
      expect(panel.textContent).toContain('On track to reach the floor by');
    } else {
      expect(panel.textContent).toContain('Projected overage of');
    }
  });

  // ---- Per-member usage table -----------------------------------------------

  it('shows empty usage state when no member data', async () => {
    getOrgUsage = vi.fn(() => of(makeUsage([])));
    await render(makeOrg('owner'));
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('No usage yet this cycle.');
  });

  it('renders per-member metadata table', async () => {
    const members = [
      makeMemberUsage({
        user: 'u1',
        display_name: 'Pat',
        cost_rappen: 500,
        completions: 10,
      }),
      makeMemberUsage({
        user: 'u2',
        display_name: 'Sam',
        cost_rappen: 300,
        completions: 5,
      }),
    ];
    getOrgUsage = vi.fn(() => of(makeUsage(members)));
    await render(makeOrg('owner'));
    fixture.detectChanges();

    const rows = fixture.nativeElement.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('Pat');
    expect(rows[0].textContent).toContain('10');
  });

  // ---- Portal / checkout navigation seams -----------------------------------

  it('calls getOrgBillingPortal and opens portal for owner', async () => {
    const openUrl = vi.fn();
    getOrgBilling = vi.fn(() => of(makeBilling({ past_due: true })));
    await render(makeOrg('owner'));
    fixture.detectChanges();

    component['openUrl'] = openUrl;
    component['openPortal']();

    expect(getOrgBillingPortal).toHaveBeenCalledWith('org_1');
    expect(openUrl).toHaveBeenCalledWith('https://portal');
  });

  it('calls createOrgCheckout and redirects for owner', async () => {
    const redirect = vi.fn<(url: string) => void>();
    getOrgBilling = vi.fn(() => of(makeBilling({ plan_type: 'inactive' })));
    await render(makeOrg('owner'));
    fixture.detectChanges();

    component['redirect'] = redirect;
    component['startCheckout']();

    expect(createOrgCheckout).toHaveBeenCalledWith('org_1');
    expect(redirect).toHaveBeenCalledWith('https://checkout');
  });

  it('shows error alert when portal call fails', async () => {
    TestBed.resetTestingModule();
    getOrgBillingPortal = vi.fn(() => throwError(() => new Error('boom')));
    getOrgBilling = vi.fn(() => of(makeBilling({ past_due: true })));

    await TestBed.configureTestingModule({
      imports: [OrgBillingComponent],
      providers: [
        {
          provide: CognosApiService,
          useValue: {
            getOrgBilling,
            getOrgUsage,
            getOrgBillingPortal,
            createOrgCheckout,
          },
        },
        { provide: ModelService, useValue: { modelList } },
        { provide: ErrorService, useValue: { alert: errorAlert } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(OrgBillingComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('org', makeOrg('owner'));
    fixture.detectChanges();
    await fixture.whenStable();

    component['openPortal']();

    expect(errorAlert).toHaveBeenCalled();
  });
});
