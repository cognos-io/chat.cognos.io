import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { of, throwError } from 'rxjs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { OrganisationRecord } from '@app/interfaces/organisation';
import { CognosApiService } from '@app/services/cognos-api.service';
import { OrganisationService } from '@app/services/organisation.service';

import { InviteAcceptComponent } from './invite-accept.component';

const acme: OrganisationRecord = {
  id: 'org_1',
  name: 'Acme Legal',
  role: 'member',
  created: '2026-01-01T00:00:00Z',
  policy_privacy_tier: '',
  policy_retention_days: 0,
  policy_mfa_required: false,
};

describe('InviteAcceptComponent', () => {
  let fixture: ComponentFixture<InviteAcceptComponent>;
  let acceptOrgInvite: ReturnType<typeof vi.fn>;
  let refreshMemberships: ReturnType<typeof vi.fn>;
  let setActiveWorkspace: ReturnType<typeof vi.fn>;
  let activeWorkspaceValue: string;

  async function render(token = ''): Promise<ComponentFixture<InviteAcceptComponent>> {
    await TestBed.configureTestingModule({
      imports: [InviteAcceptComponent],
      providers: [
        provideRouter([]),
        { provide: CognosApiService, useValue: { acceptOrgInvite } },
        {
          provide: OrganisationService,
          useValue: {
            refreshMemberships,
            setActiveWorkspace,
            activeWorkspace: () => activeWorkspaceValue,
            orgName: (orgId: string | undefined) =>
              orgId === acme.id ? acme.name : null,
          },
        },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(InviteAcceptComponent);
    fixture.componentRef.setInput('token', token);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    return fixture;
  }

  beforeEach(() => {
    TestBed.resetTestingModule();
    vi.clearAllMocks();
    acceptOrgInvite = vi.fn(() => of({ organisation: acme.id, role: 'member' }));
    refreshMemberships = vi.fn(() => of([acme]));
    setActiveWorkspace = vi.fn((id: string) => {
      activeWorkspaceValue = id;
    });
    activeWorkspaceValue = 'personal';
  });

  // ---- Deep link (?token=…) ---------------------------------------------------

  it('auto-accepts a deep-linked token and switches to the new workspace', async () => {
    await render('tok_deep_link');

    expect(acceptOrgInvite).toHaveBeenCalledWith({ token: 'tok_deep_link' });
    expect(acceptOrgInvite).toHaveBeenCalledTimes(1);
    expect(refreshMemberships).toHaveBeenCalled();
    expect(setActiveWorkspace).toHaveBeenCalledWith('org_1');

    const content = fixture.nativeElement.textContent;
    expect(content).toContain('Welcome to Acme Legal');
    expect(content).toContain('You joined as');
    expect(content).toContain('Member');
    // Friction #3 (persona PER-006): same Account, no new Emergency Kit.
    expect(content).toContain('same Account Key, no new Emergency Kit');
  });

  it('shows the manual paste form when no token is in the URL', async () => {
    await render();

    expect(acceptOrgInvite).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain('Join an Organisation');
    expect(fixture.nativeElement.querySelector('form')).not.toBeNull();
  });

  // ---- Manual paste -----------------------------------------------------------

  it('accepts a manually pasted token', async () => {
    await render();
    const component = fixture.componentInstance;

    component['manualToken'].set('  tok_pasted  ');
    component['submitManual']();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    // Whitespace-trimmed before sending.
    expect(acceptOrgInvite).toHaveBeenCalledWith({ token: 'tok_pasted' });
    expect(fixture.nativeElement.textContent).toContain('Welcome to Acme Legal');
  });

  it('ignores submit with an empty token', async () => {
    await render();
    const component = fixture.componentInstance;

    component['manualToken'].set('   ');
    component['submitManual']();

    expect(acceptOrgInvite).not.toHaveBeenCalled();
  });

  // ---- Neutral errors + retry -------------------------------------------------

  it('shows the neutral error copy with a retry field for a bad token', async () => {
    acceptOrgInvite = vi.fn(() => throwError(() => ({ status: 404 })));
    await render('tok_expired');

    const content = fixture.nativeElement.textContent;
    // Neutral by design: expired, consumed and unknown are indistinguishable.
    expect(content).toContain("That invite didn't work.");
    expect(content).toContain('Try again');
    expect(fixture.nativeElement.querySelector('form')).not.toBeNull();
  });

  it('recovers when a retry with a fresh token succeeds', async () => {
    acceptOrgInvite = vi.fn(() => throwError(() => ({ status: 404 })));
    await render('tok_bad');

    acceptOrgInvite.mockReturnValue(of({ organisation: acme.id, role: 'admin' }));
    const component = fixture.componentInstance;
    component['manualToken'].set('tok_good');
    component['submitManual']();
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();

    const content = fixture.nativeElement.textContent;
    expect(content).toContain('Welcome to Acme Legal');
    expect(content).toContain('Admin');
  });

  // ---- Idempotent accept (already a member) -----------------------------------

  it('treats an idempotent accept for an active member as a normal success', async () => {
    // The backend returns 200 with the current role for an active member.
    acceptOrgInvite = vi.fn(() => of({ organisation: acme.id, role: 'member' }));
    await render('tok_again');

    expect(fixture.nativeElement.textContent).toContain('Welcome to Acme Legal');
  });

  // ---- Membership refresh failure stays a success ------------------------------

  it('still succeeds (with the sidebar hint) when the membership refresh fails', async () => {
    refreshMemberships = vi.fn(() => throwError(() => new Error('offline')));
    await render('tok_deep_link');

    const content = fixture.nativeElement.textContent;
    // The membership exists server-side — never show an error for a refresh
    // hiccup; fall back to a generic name and the manual switch hint.
    expect(content).toContain('Welcome to your organisation');
    expect(content).toContain('workspace switcher');
    expect(setActiveWorkspace).not.toHaveBeenCalled();
  });
});
