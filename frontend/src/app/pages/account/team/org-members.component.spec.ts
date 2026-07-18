import { Dialog } from '@angular/cdk/dialog';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { NEVER, of, throwError } from 'rxjs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CognosToastService } from '@cognos/ui-angular';

import { OrgMemberRecord, OrganisationRecord } from '@app/interfaces/organisation';
import { AuthService } from '@app/services/auth.service';
import { CognosApiService } from '@app/services/cognos-api.service';
import { ErrorService } from '@app/services/error.service';

import { OrgMembersComponent } from './org-members.component';

function makeOrg(role: OrganisationRecord['role']): OrganisationRecord {
  return { id: 'org_1', name: 'Acme', role, created: '2026-01-01T00:00:00Z' };
}

function makeMember(overrides: Partial<OrgMemberRecord> = {}): OrgMemberRecord {
  return {
    user_id: 'user_' + Math.random().toString(36).slice(2),
    display_name: 'Pat',
    email: 'pat@example.com',
    role: 'member',
    added_at: '2026-01-15T00:00:00Z',
    ...overrides,
  };
}

describe('OrgMembersComponent', () => {
  let fixture: ComponentFixture<OrgMembersComponent>;
  let component: OrgMembersComponent;
  let listOrgMembers: ReturnType<typeof vi.fn>;
  let removeOrgMember: ReturnType<typeof vi.fn>;
  let dialogConfirm: boolean;
  let toastNotify: ReturnType<typeof vi.fn>;
  let errorAlert: ReturnType<typeof vi.fn>;

  const authUser = signal<unknown>({ id: 'user_me' });

  async function render(org: OrganisationRecord) {
    await TestBed.configureTestingModule({
      imports: [OrgMembersComponent],
      providers: [
        {
          provide: CognosApiService,
          useValue: { listOrgMembers, removeOrgMember },
        },
        {
          provide: AuthService,
          useValue: { user: authUser },
        },
        {
          provide: Dialog,
          useValue: { open: () => ({ closed: of(dialogConfirm) }) },
        },
        { provide: CognosToastService, useValue: { notify: toastNotify } },
        { provide: ErrorService, useValue: { alert: errorAlert } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(OrgMembersComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('org', org);
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    authUser.set({ id: 'user_me' });
    listOrgMembers = vi.fn(() => of([]));
    removeOrgMember = vi.fn(() => of(undefined));
    dialogConfirm = true;
    toastNotify = vi.fn();
    errorAlert = vi.fn();
  });

  // ---- Loading / error / empty ----------------------------------------------

  it('shows loading state initially', async () => {
    listOrgMembers = vi.fn(() => NEVER);
    await render(makeOrg('owner'));
    expect(fixture.nativeElement.textContent).toContain('Loading…');
  });

  it('shows error state when listOrgMembers fails', async () => {
    listOrgMembers = vi.fn(() => throwError(() => new Error('boom')));
    await render(makeOrg('owner'));
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      'Could not load members. Please try again.',
    );
    expect(fixture.nativeElement.textContent).not.toContain('Loading…');
  });

  it('shows empty state when there are no members', async () => {
    await render(makeOrg('owner'));

    expect(fixture.nativeElement.textContent).toContain('No members yet.');
  });

  // ---- Table rendering ------------------------------------------------------

  it('renders members with roles and disables remove for owner row', async () => {
    const owner = makeMember({
      user_id: 'user_owner',
      role: 'owner',
      display_name: 'Owner',
    });
    const admin = makeMember({
      user_id: 'user_admin',
      role: 'admin',
      display_name: 'Admin',
    });
    listOrgMembers = vi.fn(() => of([owner, admin]));
    await render(makeOrg('owner'));

    const rows = fixture.nativeElement.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(2);

    const ownerRow = rows[0];
    expect(ownerRow.textContent).toContain('Owner');
    const ownerBtn = ownerRow.querySelector(
      'cog-button button',
    ) as HTMLButtonElement | null;
    expect(ownerBtn?.disabled).toBe(true);

    const adminRow = rows[1];
    expect(adminRow.textContent).toContain('Admin');
    const adminBtn = adminRow.querySelector(
      'cog-button button',
    ) as HTMLButtonElement | null;
    expect(adminBtn?.disabled).toBe(false);
  });

  it("disables remove for the caller's own row", async () => {
    authUser.set({ id: 'user_self' });
    const self = makeMember({ user_id: 'user_self', role: 'member' });
    listOrgMembers = vi.fn(() => of([self]));
    await render(makeOrg('owner'));

    const btn = fixture.nativeElement.querySelector(
      'tbody tr cog-button button',
    ) as HTMLButtonElement | null;
    expect(btn?.disabled).toBe(true);
  });

  // ---- Offboard flow --------------------------------------------------------

  it('does not call removeOrgMember when dialog is cancelled', async () => {
    dialogConfirm = false;
    const member = makeMember({ user_id: 'user_x', role: 'member' });
    listOrgMembers = vi.fn(() => of([member]));
    await render(makeOrg('owner'));

    await component['offboard'](member);

    expect(removeOrgMember).not.toHaveBeenCalled();
  });

  it('calls removeOrgMember and refreshes list when confirmed', async () => {
    dialogConfirm = true;
    const member = makeMember({ user_id: 'user_x', role: 'member' });
    listOrgMembers = vi.fn(() => of([member]));
    await render(makeOrg('owner'));

    await component['offboard'](member);

    expect(removeOrgMember).toHaveBeenCalledWith('org_1', 'user_x');
    expect(toastNotify).toHaveBeenCalled();
    // list refresh triggered: second call (first is on init)
    expect(listOrgMembers).toHaveBeenCalledTimes(2);
  });

  it('shows error alert when removeOrgMember fails', async () => {
    TestBed.resetTestingModule();
    removeOrgMember = vi.fn(() => throwError(() => new Error('boom')));
    const member = makeMember({ user_id: 'user_x', role: 'member' });
    listOrgMembers = vi.fn(() => of([member]));

    await TestBed.configureTestingModule({
      imports: [OrgMembersComponent],
      providers: [
        {
          provide: CognosApiService,
          useValue: { listOrgMembers, removeOrgMember },
        },
        {
          provide: AuthService,
          useValue: { user: authUser },
        },
        {
          provide: Dialog,
          useValue: { open: () => ({ closed: of(dialogConfirm) }) },
        },
        { provide: CognosToastService, useValue: { notify: toastNotify } },
        { provide: ErrorService, useValue: { alert: errorAlert } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(OrgMembersComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('org', makeOrg('owner'));
    fixture.detectChanges();
    await fixture.whenStable();

    await component['offboard'](member);

    expect(errorAlert).toHaveBeenCalled();
  });

  it('uses display_name fallback to email then user_id', () => {
    expect(
      component['memberName']({
        display_name: 'A',
        email: 'b',
        user_id: 'c',
      } as OrgMemberRecord),
    ).toBe('A');
    expect(
      component['memberName']({
        display_name: '',
        email: 'b',
        user_id: 'c',
      } as OrgMemberRecord),
    ).toBe('b');
    expect(
      component['memberName']({
        display_name: '',
        email: '',
        user_id: 'c',
      } as OrgMemberRecord),
    ).toBe('c');
  });
});
