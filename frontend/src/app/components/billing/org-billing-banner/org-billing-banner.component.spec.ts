import { ComponentFixture, TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  OrgBillingRestrictionCode,
  OrgCompletionBillingRestriction,
} from '@app/interfaces/billing';
import { OrgRole, OrganisationRecord } from '@app/interfaces/organisation';
import { OrganisationService } from '@app/services/organisation.service';

import { OrgBillingBannerComponent } from './org-billing-banner.component';

const restriction = (
  code: OrgBillingRestrictionCode = 'ORG_BILLING_PAST_DUE',
): OrgCompletionBillingRestriction => ({
  code,
  organisationId: 'org_1',
  organisationName: 'Acme (stale)',
  message: 'backend member copy',
  adminMessage: 'backend admin copy',
});

describe('OrgBillingBannerComponent', () => {
  let fixture: ComponentFixture<OrgBillingBannerComponent>;
  let navigate: ReturnType<typeof vi.fn>;

  async function render(
    viewerRole: OrgRole | null,
    block = restriction(),
  ): Promise<void> {
    const memberships: OrganisationRecord[] = viewerRole
      ? [
          {
            id: 'org_1',
            name: 'Acme Legal',
            role: viewerRole,
            created: '',
            policy_privacy_tier: '' as const,
            policy_retention_days: 0,
            policy_mfa_required: false,
          },
        ]
      : [];
    await TestBed.configureTestingModule({
      imports: [OrgBillingBannerComponent],
      providers: [
        { provide: Router, useValue: { navigate } },
        {
          provide: OrganisationService,
          useValue: {
            memberships: () => memberships,
            orgName: (orgId: string | undefined) =>
              memberships.find((org) => org.id === orgId)?.name ?? null,
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(OrgBillingBannerComponent);
    fixture.componentRef.setInput('block', block);
    fixture.detectChanges();
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    navigate = vi.fn();
  });

  // Member view: neutral copy, no admin step, no billing CTA — and it must
  // never suggest the member's personal balance could cover org work.
  it('shows the neutral member view for a plain member', async () => {
    await render('member');

    const content = fixture.nativeElement.textContent;
    expect(content).toContain('Acme Legal has a payment issue');
    expect(content).toContain('personal workspace keeps working');
    expect(content).toContain('Ask an owner or admin of Acme Legal');
    expect(content).not.toContain('Update the payment method');
    expect(fixture.nativeElement.querySelector('button')).toBeNull();
  });

  it.each([['owner' as const], ['admin' as const]])(
    'shows the actionable step and team-billing link to an %s',
    async (role) => {
      await render(role);

      const content = fixture.nativeElement.textContent;
      expect(content).toContain('Update the payment method for Acme Legal');
      expect(content).toContain('Open team billing');
      expect(content).not.toContain('Ask an owner or admin');

      (fixture.nativeElement.querySelector('button') as HTMLButtonElement).click();
      expect(navigate).toHaveBeenCalledWith(['/account/team']);
    },
  );

  it('uses the inactive copy for ORG_BILLING_INACTIVE', async () => {
    await render('admin', restriction('ORG_BILLING_INACTIVE'));

    const content = fixture.nativeElement.textContent;
    expect(content).toContain('Acme Legal billing is paused');
    expect(content).toContain('Add a payment method to reactivate Acme Legal');
  });

  // The membership record's name is fresher than the 402 body's snapshot; the
  // body's name is only the fallback when the membership is unknown.
  it('falls back to the 402 body name when the viewer has no membership record', async () => {
    await render(null);

    expect(fixture.nativeElement.textContent).toContain('Acme (stale)');
  });
});
