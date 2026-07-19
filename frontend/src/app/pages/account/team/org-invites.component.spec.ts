import { Dialog } from '@angular/cdk/dialog';
import { ComponentFixture, TestBed } from '@angular/core/testing';

import { NEVER, of, throwError } from 'rxjs';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { CognosToastService } from '@cognos/ui-angular';

import { OrgInviteRecord, OrganisationRecord } from '@app/interfaces/organisation';
import { CognosApiService } from '@app/services/cognos-api.service';
import { ErrorService } from '@app/services/error.service';

import { OrgInvitesComponent } from './org-invites.component';

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

function makeInvite(overrides: Partial<OrgInviteRecord> = {}): OrgInviteRecord {
  return {
    id: 'inv_1',
    invited_email: 'pat@example.com',
    role: 'member',
    expires_at: '2026-12-31T00:00:00Z',
    ...overrides,
  };
}

describe('OrgInvitesComponent', () => {
  let fixture: ComponentFixture<OrgInvitesComponent>;
  let component: OrgInvitesComponent;
  let listOrgInvites: ReturnType<typeof vi.fn>;
  let createOrgInvite: ReturnType<typeof vi.fn>;
  let revokeOrgInvite: ReturnType<typeof vi.fn>;
  let dialogConfirm: boolean;
  let toastNotify: ReturnType<typeof vi.fn>;
  let errorAlert: ReturnType<typeof vi.fn>;
  let writeText: ReturnType<typeof vi.fn>;
  let originalClipboardDescriptor: PropertyDescriptor | undefined;

  async function render() {
    await TestBed.configureTestingModule({
      imports: [OrgInvitesComponent],
      providers: [
        {
          provide: CognosApiService,
          useValue: { listOrgInvites, createOrgInvite, revokeOrgInvite },
        },
        {
          provide: Dialog,
          useValue: { open: () => ({ closed: of(dialogConfirm) }) },
        },
        { provide: CognosToastService, useValue: { notify: toastNotify } },
        { provide: ErrorService, useValue: { alert: errorAlert } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(OrgInvitesComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('org', makeOrg());
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    listOrgInvites = vi.fn(() => of([]));
    createOrgInvite = vi.fn(() => of({ ...makeInvite(), token: 'tok_abc123' }));
    revokeOrgInvite = vi.fn(() => of(undefined));
    dialogConfirm = true;
    toastNotify = vi.fn();
    errorAlert = vi.fn();
    writeText = vi.fn(() => Promise.resolve());

    originalClipboardDescriptor = Object.getOwnPropertyDescriptor(
      globalThis.navigator,
      'clipboard',
    );
    Object.defineProperty(globalThis.navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
  });

  afterEach(() => {
    if (originalClipboardDescriptor) {
      Object.defineProperty(
        globalThis.navigator,
        'clipboard',
        originalClipboardDescriptor,
      );
    } else {
      Reflect.deleteProperty(globalThis.navigator, 'clipboard');
    }
  });

  // ---- Loading / error / empty ----------------------------------------------

  it('shows loading state initially', async () => {
    listOrgInvites = vi.fn(() => NEVER);
    await render();
    expect(fixture.nativeElement.textContent).toContain('Loading…');
  });

  it('shows error state when listOrgInvites fails', async () => {
    listOrgInvites = vi.fn(() => throwError(() => new Error('boom')));
    await render();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      'Could not load invites. Please try again.',
    );
  });

  it('shows empty state when there are no invites', async () => {
    await render();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('No pending invites.');
  });

  // ---- Create invite + shown-once token -------------------------------------

  it('creates an invite and shows the shareable link once', async () => {
    await render();

    component['email'].set('new@example.com');
    component['setRole']('admin');
    component['create']();

    expect(createOrgInvite).toHaveBeenCalledWith('org_1', {
      email: 'new@example.com',
      role: 'admin',
    });

    fixture.detectChanges();
    const linkInput = fixture.nativeElement.querySelector(
      'cog-text-field input',
    ) as HTMLInputElement | null;
    expect(linkInput?.value).toMatch(/\/invite\?token=tok_abc123$/);
    expect(fixture.nativeElement.textContent).toContain(
      'Send this link to your colleague.',
    );
  });

  it('dismissing the link clears it from DOM and recreates the form', async () => {
    await render();

    component['email'].set('new@example.com');
    component['create']();
    fixture.detectChanges();
    const linkBefore = fixture.nativeElement.querySelector(
      'cog-text-field input',
    ) as HTMLInputElement | null;
    expect(linkBefore?.value).toMatch(/\/invite\?token=tok_abc123$/);

    component['dismissToken']();
    fixture.detectChanges();

    const inputs = Array.from(
      fixture.nativeElement.querySelectorAll('cog-text-field input'),
    ) as HTMLInputElement[];
    expect(inputs.some((i) => i.value.endsWith('/invite?token=tok_abc123'))).toBe(
      false,
    );
    expect(fixture.nativeElement.querySelector('form')).not.toBeNull();
  });

  it('creates a link invite when email is empty', async () => {
    await render();

    component['email'].set('');
    component['setRole']('member');
    component['create']();

    expect(createOrgInvite).toHaveBeenCalledWith('org_1', { role: 'member' });
  });

  it('copies the invite link to clipboard and shows toast', async () => {
    await render();

    component['email'].set('x@y');
    component['create']();
    fixture.detectChanges();

    await component['copyLink']();

    expect(writeText).toHaveBeenCalledWith(
      expect.stringMatching(/\/invite\?token=tok_abc123$/),
    );
    expect(toastNotify).toHaveBeenCalled();
  });

  it('shows an actionable error when the clipboard write fails', async () => {
    writeText.mockRejectedValueOnce(new Error('clipboard denied'));
    await render();

    component['email'].set('x@y');
    component['create']();
    await component['copyLink']();

    expect(errorAlert).toHaveBeenCalledWith(
      'Could not copy the invite link. Select it and copy it manually.',
    );
  });

  it('shows error alert when createOrgInvite fails', async () => {
    TestBed.resetTestingModule();
    createOrgInvite = vi.fn(() => throwError(() => new Error('boom')));

    await TestBed.configureTestingModule({
      imports: [OrgInvitesComponent],
      providers: [
        {
          provide: CognosApiService,
          useValue: { listOrgInvites, createOrgInvite, revokeOrgInvite },
        },
        {
          provide: Dialog,
          useValue: { open: () => ({ closed: of(dialogConfirm) }) },
        },
        { provide: CognosToastService, useValue: { notify: toastNotify } },
        { provide: ErrorService, useValue: { alert: errorAlert } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(OrgInvitesComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('org', makeOrg());
    fixture.detectChanges();
    await fixture.whenStable();

    component['email'].set('x@y');
    component['create']();

    expect(errorAlert).toHaveBeenCalled();
  });

  it('does not copy when the invite link is empty', async () => {
    await render();

    await component['copyLink']();

    expect(writeText).not.toHaveBeenCalled();
  });

  // ---- Revoke ---------------------------------------------------------------

  it('does not revoke when dialog is cancelled', async () => {
    dialogConfirm = false;
    const invite = makeInvite();
    listOrgInvites = vi.fn(() => of([invite]));
    await render();

    await component['revoke'](invite);

    expect(revokeOrgInvite).not.toHaveBeenCalled();
  });

  it('revokes and refreshes list when confirmed', async () => {
    dialogConfirm = true;
    const invite = makeInvite();
    listOrgInvites = vi.fn(() => of([invite]));
    await render();

    await component['revoke'](invite);

    expect(revokeOrgInvite).toHaveBeenCalledWith('org_1', 'inv_1');
    expect(toastNotify).toHaveBeenCalled();
    // refresh triggered: second call (first is on init)
    expect(listOrgInvites).toHaveBeenCalledTimes(2);
  });

  it('shows error alert when revokeOrgInvite fails', async () => {
    TestBed.resetTestingModule();
    dialogConfirm = true;
    revokeOrgInvite = vi.fn(() => throwError(() => new Error('boom')));
    const invite = makeInvite();
    listOrgInvites = vi.fn(() => of([invite]));

    await TestBed.configureTestingModule({
      imports: [OrgInvitesComponent],
      providers: [
        {
          provide: CognosApiService,
          useValue: { listOrgInvites, createOrgInvite, revokeOrgInvite },
        },
        {
          provide: Dialog,
          useValue: { open: () => ({ closed: of(dialogConfirm) }) },
        },
        { provide: CognosToastService, useValue: { notify: toastNotify } },
        { provide: ErrorService, useValue: { alert: errorAlert } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(OrgInvitesComponent);
    component = fixture.componentInstance;
    fixture.componentRef.setInput('org', makeOrg());
    fixture.detectChanges();
    await fixture.whenStable();

    await component['revoke'](invite);

    expect(errorAlert).toHaveBeenCalled();
  });

  // ---- Pending list ---------------------------------------------------------

  it('renders the pending invites table', async () => {
    const invites = [
      makeInvite({ id: 'inv_1', invited_email: 'a@b', role: 'member' }),
      makeInvite({ id: 'inv_2', invited_email: '', role: 'admin' }),
    ];
    listOrgInvites = vi.fn(() => of(invites));
    await render();
    fixture.detectChanges();

    const rows = fixture.nativeElement.querySelectorAll('tbody tr');
    expect(rows).toHaveLength(2);
    expect(rows[0].textContent).toContain('a@b');
    expect(rows[1].textContent).toContain('Link invite');
  });
});
