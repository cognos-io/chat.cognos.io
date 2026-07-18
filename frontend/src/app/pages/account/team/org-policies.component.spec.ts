import { ComponentFixture, TestBed } from '@angular/core/testing';

import { of, throwError } from 'rxjs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CognosToastService } from '@cognos/ui-angular';

import { OrganisationRecord } from '@app/interfaces/organisation';
import { CognosApiService } from '@app/services/cognos-api.service';
import { ErrorService } from '@app/services/error.service';

import { OrgPoliciesComponent } from './org-policies.component';

function makeOrg(overrides: Partial<OrganisationRecord> = {}): OrganisationRecord {
  return {
    id: 'org_1',
    name: 'Acme',
    role: 'owner',
    created: '2026-01-01T00:00:00Z',
    policy_privacy_tier: '',
    policy_retention_days: 0,
    policy_mfa_required: false,
    ...overrides,
  };
}

describe('OrgPoliciesComponent', () => {
  let fixture: ComponentFixture<OrgPoliciesComponent>;
  let component: OrgPoliciesComponent;
  let updateOrgPolicies: ReturnType<typeof vi.fn>;
  let toastNotify: ReturnType<typeof vi.fn>;
  let errorAlert: ReturnType<typeof vi.fn>;

  async function render(org: OrganisationRecord) {
    await TestBed.configureTestingModule({
      imports: [OrgPoliciesComponent],
      providers: [
        { provide: CognosApiService, useValue: { updateOrgPolicies } },
        { provide: CognosToastService, useValue: { notify: toastNotify } },
        { provide: ErrorService, useValue: { alert: errorAlert } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(OrgPoliciesComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('org', org);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    updateOrgPolicies = vi.fn((_orgId: string, changes: object) =>
      of({ ...makeOrg(), ...changes }),
    );
    toastNotify = vi.fn();
    errorAlert = vi.fn();
  });

  // ---- Role visibility ------------------------------------------------------

  it('shows the editable form with a save button for an owner', async () => {
    await render(makeOrg({ role: 'owner' }));

    expect(fixture.nativeElement.querySelector('form')).not.toBeNull();
    expect(fixture.nativeElement.textContent).toContain('Save policies');
  });

  it('shows the editable form for an admin', async () => {
    await render(makeOrg({ role: 'admin' }));

    expect(fixture.nativeElement.querySelector('form')).not.toBeNull();
  });

  it('shows a read-only summary — no form, no save — for a member', async () => {
    await render(makeOrg({ role: 'member' }));

    expect(fixture.nativeElement.querySelector('form')).toBeNull();
    expect(fixture.nativeElement.textContent).not.toContain('Save policies');
    // Unset policies read as their plain-words defaults.
    expect(fixture.nativeElement.textContent).toContain('No ceiling');
    expect(fixture.nativeElement.textContent).toContain('No automatic deletion');
    expect(fixture.nativeElement.textContent).toContain('Not required');
  });

  it('renders set policy values in the member summary', async () => {
    await render(
      makeOrg({
        role: 'member',
        policy_privacy_tier: 'eu',
        policy_retention_days: 30,
        policy_mfa_required: true,
      }),
    );

    expect(fixture.nativeElement.textContent).toContain('Europe + Switzerland + UK');
    expect(fixture.nativeElement.textContent).toContain('30 days');
    expect(fixture.nativeElement.textContent).toContain('Required');
  });

  it('uses the singular day form for a one-day retention', async () => {
    await render(makeOrg({ role: 'member', policy_retention_days: 1 }));

    expect(fixture.nativeElement.textContent).toContain('1 day');
    expect(fixture.nativeElement.textContent).not.toContain('1 days');
  });

  // ---- Dirty tracking & validation -------------------------------------------

  it('disables save while nothing has changed', async () => {
    await render(makeOrg());

    const btn = fixture.nativeElement.querySelector(
      'cog-button button',
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(true);
    expect(component['canSave']()).toBe(false);
  });

  it('enables save when the privacy tier ceiling changes', async () => {
    await render(makeOrg());

    component['setTier']('ch_only');
    fixture.detectChanges();

    const btn = fixture.nativeElement.querySelector(
      'cog-button button',
    ) as HTMLButtonElement;
    expect(btn.disabled).toBe(false);
  });

  it('ignores an unknown tier value from the chip group', async () => {
    await render(makeOrg());

    component['setTier'](null);
    component['setTier']('bogus');

    expect(component['tier']()).toBe('');
    expect(component['canSave']()).toBe(false);
  });

  it('rejects non-numeric, negative and fractional retention values', async () => {
    await render(makeOrg({ policy_retention_days: 30 }));

    for (const bad of ['abc', '-1', '1.5', '']) {
      component['retention'].set(bad);
      expect(component['retentionValid']()).toBe(false);
      expect(component['canSave']()).toBe(false);
    }
    fixture.detectChanges();

    // The field error is announced (cog-field renders role="alert").
    expect(fixture.nativeElement.textContent).toContain(
      'Enter a whole number of days (0 or more).',
    );
  });

  it('does not call the API when save is invoked with an invalid form', async () => {
    await render(makeOrg());

    component['retention'].set('nope');
    component['save']();

    expect(updateOrgPolicies).not.toHaveBeenCalled();
  });

  // ---- Saving: partial PATCH bodies ------------------------------------------

  it('sends only the changed field — privacy tier', async () => {
    await render(makeOrg());

    component['setTier']('eu');
    component['save']();

    expect(updateOrgPolicies).toHaveBeenCalledWith('org_1', {
      policy_privacy_tier: 'eu',
    });
  });

  it('accepts 0 days (= no auto-delete) and sends only retention', async () => {
    await render(makeOrg({ policy_retention_days: 30 }));

    component['retention'].set('0');
    component['save']();

    expect(updateOrgPolicies).toHaveBeenCalledWith('org_1', {
      policy_retention_days: 0,
    });
  });

  it('sends all three fields when all three change', async () => {
    await render(makeOrg());

    component['setTier']('global');
    component['retention'].set('90');
    component['mfa'].set(true);
    component['save']();

    expect(updateOrgPolicies).toHaveBeenCalledWith('org_1', {
      policy_privacy_tier: 'global',
      policy_retention_days: 90,
      policy_mfa_required: true,
    });
  });

  it('notifies and emits the updated record on success', async () => {
    await render(makeOrg());
    const updated = vi.fn();
    component.updated.subscribe(updated);

    component['mfa'].set(true);
    component['save']();

    expect(toastNotify).toHaveBeenCalled();
    expect(updated).toHaveBeenCalledWith(
      expect.objectContaining({ policy_mfa_required: true }),
    );
  });

  it('alerts and keeps the form editable when the save fails', async () => {
    updateOrgPolicies = vi.fn(() => throwError(() => new Error('boom')));
    await render(makeOrg());

    component['setTier']('eu');
    component['save']();

    expect(errorAlert).toHaveBeenCalled();
    expect(component['savePending']()).toBe(false);
  });

  // ---- MFA warning ------------------------------------------------------------

  it('warns before enabling the MFA requirement — it applies immediately', async () => {
    await render(makeOrg({ policy_mfa_required: false }));

    expect(fixture.nativeElement.querySelector('cog-callout')).toBeNull();

    component['mfa'].set(true);
    fixture.detectChanges();

    const callout = fixture.nativeElement.querySelector('cog-callout');
    expect(callout).not.toBeNull();
    expect(callout.textContent).toContain('as soon as you save');
  });

  it('shows no warning when MFA is already required or being disabled', async () => {
    await render(makeOrg({ policy_mfa_required: true }));

    expect(fixture.nativeElement.querySelector('cog-callout')).toBeNull();

    component['mfa'].set(false);
    fixture.detectChanges();

    expect(fixture.nativeElement.querySelector('cog-callout')).toBeNull();
  });

  // ---- A11y ---------------------------------------------------------------------

  it('labels the MFA toggle and links it to the adjacent label element', async () => {
    await render(makeOrg());

    const toggle = fixture.nativeElement.querySelector(
      'cog-toggle button',
    ) as HTMLButtonElement;
    expect(toggle.getAttribute('aria-label')).toBe('Require two-factor authentication');

    const label = fixture.nativeElement.querySelector(
      'label.org-policies__mfa-label',
    ) as HTMLLabelElement;
    expect(label.htmlFor).toBe(toggle.id);
  });
});
