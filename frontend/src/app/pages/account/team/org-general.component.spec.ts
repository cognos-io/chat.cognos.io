import { Dialog } from '@angular/cdk/dialog';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { of, throwError } from 'rxjs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CognosToastService } from '@cognos/ui-angular';

import { OrganisationRecord } from '@app/interfaces/organisation';
import { CognosApiService } from '@app/services/cognos-api.service';
import { ErrorService } from '@app/services/error.service';

import { OrgGeneralComponent } from './org-general.component';

const ownerOrg: OrganisationRecord = {
  id: 'org_acme',
  name: 'Acme Legal',
  role: 'owner',
  created: '2026-07-01T00:00:00Z',
  policy_privacy_tier: '',
  policy_retention_days: 0,
  policy_mfa_required: false,
};

describe('OrgGeneralComponent dissolution', () => {
  let fixture: ComponentFixture<OrgGeneralComponent>;
  let component: OrgGeneralComponent;
  let dissolveOrg: ReturnType<typeof vi.fn>;
  let dialogResult: boolean;
  let notify: ReturnType<typeof vi.fn>;
  let alert: ReturnType<typeof vi.fn>;

  function render(org: OrganisationRecord = ownerOrg) {
    TestBed.configureTestingModule({
      imports: [OrgGeneralComponent],
      providers: [
        {
          provide: CognosApiService,
          useValue: { updateOrg: vi.fn(), dissolveOrg },
        },
        {
          provide: Dialog,
          useValue: { open: vi.fn(() => ({ closed: of(dialogResult) })) },
        },
        { provide: CognosToastService, useValue: { notify } },
        { provide: ErrorService, useValue: { alert } },
      ],
    });
    fixture = TestBed.createComponent(OrgGeneralComponent);
    fixture.componentRef.setInput('org', org);
    component = fixture.componentInstance;
    fixture.detectChanges();
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    dialogResult = true;
    dissolveOrg = vi.fn(() => of(undefined));
    notify = vi.fn();
    alert = vi.fn();
  });

  it('offers dissolution to the Owner but never to an Admin', () => {
    render();
    expect(fixture.nativeElement.textContent).toContain('Dissolve Organisation');

    TestBed.resetTestingModule();
    render({ ...ownerOrg, role: 'admin' });
    expect(fixture.nativeElement.textContent).not.toContain('Dissolve Organisation');
  });

  it('does nothing when the Owner cancels', async () => {
    dialogResult = false;
    render();

    await component['dissolve']();

    expect(dissolveOrg).not.toHaveBeenCalled();
  });

  it('emits only after the server confirms dissolution', async () => {
    render();
    const dissolved = vi.fn();
    component.dissolved.subscribe(dissolved);

    await component['dissolve']();

    expect(dissolveOrg).toHaveBeenCalledWith('org_acme');
    expect(dissolved).toHaveBeenCalledWith('org_acme');
    expect(notify).toHaveBeenCalledWith({
      title: 'Organisation dissolved',
      tone: 'success',
    });
  });

  it('keeps the action recoverable when dissolution fails', async () => {
    dissolveOrg = vi.fn(() => throwError(() => new Error('Paddle unavailable')));
    render();
    const dissolved = vi.fn();
    component.dissolved.subscribe(dissolved);

    await component['dissolve']();

    expect(component['dissolvePending']()).toBe(false);
    expect(dissolved).not.toHaveBeenCalled();
    expect(alert).toHaveBeenCalledWith(
      'Could not dissolve the Organisation. Nothing was changed. Please try again.',
    );
  });
});
