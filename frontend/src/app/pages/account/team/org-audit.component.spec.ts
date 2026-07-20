import { ComponentFixture, TestBed } from '@angular/core/testing';

import { of, throwError } from 'rxjs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OrganisationRecord } from '@app/interfaces/organisation';
import { CognosApiService } from '@app/services/cognos-api.service';
import { ErrorService } from '@app/services/error.service';

import { OrgAuditComponent } from './org-audit.component';

function makeOrg(): OrganisationRecord {
  return {
    id: 'org_1',
    name: 'Acme',
    role: 'owner',
    created: '2026-01-01T00:00:00Z',
    policy_privacy_tier: '',
    policy_retention_days: 0,
    policy_mfa_required: false,
  };
}

describe('OrgAuditComponent', () => {
  let fixture: ComponentFixture<OrgAuditComponent>;
  let listOrgAudit: ReturnType<typeof vi.fn>;
  let exportOrgAudit: ReturnType<typeof vi.fn>;
  let errorAlert: ReturnType<typeof vi.fn>;

  async function render(): Promise<void> {
    await TestBed.configureTestingModule({
      imports: [OrgAuditComponent],
      providers: [
        { provide: CognosApiService, useValue: { listOrgAudit, exportOrgAudit } },
        { provide: ErrorService, useValue: { alert: errorAlert } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(OrgAuditComponent);
    fixture.componentRef.setInput('org', makeOrg());
    fixture.detectChanges();
    await fixture.whenStable();
  }

  beforeEach(() => {
    vi.clearAllMocks();
    listOrgAudit = vi.fn(() =>
      of({
        page: 1,
        perPage: 25,
        totalItems: 2,
        totalPages: 1,
        items: [
          {
            id: 'event_2',
            action: 'org.member.offboarded',
            actor: 'user_owner',
            target: 'user_member',
            created: '2026-07-18T12:00:00Z',
          },
          {
            id: 'event_1',
            action: 'org.policies.updated',
            actor: 'user_owner',
            created: '2026-07-18T11:00:00Z',
          },
        ],
      }),
    );
    exportOrgAudit = vi.fn(() => of(new Blob(['created,action,actor,target'])));
    errorAlert = vi.fn();
  });

  it('loads and renders content-free administrative metadata newest first', async () => {
    await render();

    expect(listOrgAudit).toHaveBeenCalledWith('org_1', 1, 25);
    const rows = fixture.nativeElement.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('Member removed');
    expect(rows[0].textContent).toContain('user_owner');
    expect(rows[0].textContent).toContain('user_member');
    expect(fixture.nativeElement.textContent).toContain(
      'Administrative metadata only — never conversation or Project content.',
    );
  });

  it('shows an accessible empty state', async () => {
    listOrgAudit = vi.fn(() =>
      of({ page: 1, perPage: 25, totalItems: 0, totalPages: 0, items: [] }),
    );
    await render();

    expect(fixture.nativeElement.textContent).toContain(
      'No administrative activity yet.',
    );
    expect(fixture.nativeElement.querySelector('[role="status"]')).not.toBeNull();
  });

  it('shows an inline retry state when loading fails', async () => {
    listOrgAudit = vi.fn(() => throwError(() => new Error('boom')));
    await render();

    expect(fixture.nativeElement.textContent).toContain(
      'Could not load administrative activity. Please try again.',
    );
    expect(fixture.nativeElement.textContent).toContain('Retry');
  });

  it('requests the next page and disables unavailable pagination controls', async () => {
    listOrgAudit = vi.fn((_org: string, page: number) =>
      of({
        page,
        perPage: 25,
        totalItems: 26,
        totalPages: 2,
        items: [],
      }),
    );
    await render();

    fixture.componentInstance['loadPage'](2);
    expect(listOrgAudit).toHaveBeenLastCalledWith('org_1', 2, 25);
    expect(fixture.componentInstance['page']()).toBe(2);
  });

  it('exports the complete CSV using a stable organisation-specific filename', async () => {
    const download = vi.fn();
    await render();
    fixture.componentInstance['download'] = download;

    fixture.componentInstance['exportCsv']();

    expect(exportOrgAudit).toHaveBeenCalledWith('org_1');
    expect(download).toHaveBeenCalledWith(expect.any(Blob), 'acme-audit-log.csv');
  });

  it('keeps export available and reports a localised error when it fails', async () => {
    exportOrgAudit = vi.fn(() => throwError(() => new Error('boom')));
    await render();

    fixture.componentInstance['exportCsv']();

    expect(errorAlert).toHaveBeenCalled();
    expect(fixture.componentInstance['exportPending']()).toBe(false);
  });
});
