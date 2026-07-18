import { Dialog } from '@angular/cdk/dialog';
import { signal } from '@angular/core';
import { ComponentFixture, TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';

import { NEVER, of, throwError } from 'rxjs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { CognosToastService } from '@cognos/ui-angular';

import { OrganisationRecord } from '@app/interfaces/organisation';
import { AuthService } from '@app/services/auth.service';
import { CognosApiService } from '@app/services/cognos-api.service';
import { ErrorService } from '@app/services/error.service';
import { ModelService } from '@app/services/model.service';

import { TeamSettingsComponent } from './team-settings.component';

function makeOrg(overrides: Partial<OrganisationRecord> = {}): OrganisationRecord {
  return {
    id: 'org_' + Math.random().toString(36).slice(2, 7),
    name: 'Acme',
    role: 'owner',
    created: '2026-01-01T00:00:00Z',
    ...overrides,
  };
}

describe('TeamSettingsComponent', () => {
  let fixture: ComponentFixture<TeamSettingsComponent>;
  let component: TeamSettingsComponent;
  let listOrgs: ReturnType<typeof vi.fn>;
  let createOrg: ReturnType<typeof vi.fn>;
  let createOrgCheckout: ReturnType<typeof vi.fn>;
  let errorAlert: ReturnType<typeof vi.fn>;
  let redirect: ReturnType<typeof vi.fn<(url: string) => void>>;

  const authUser = signal<unknown>({ id: 'user_me' });

  async function render() {
    await TestBed.configureTestingModule({
      imports: [TeamSettingsComponent],
      providers: [
        provideRouter([]),
        {
          provide: CognosApiService,
          useValue: {
            listOrgs,
            createOrg,
            createOrgCheckout,
            listOrgMembers: vi.fn(() => of([])),
            removeOrgMember: vi.fn(() => of(undefined)),
            listOrgInvites: vi.fn(() => of([])),
            createOrgInvite: vi.fn(() => of({ token: '' })),
            revokeOrgInvite: vi.fn(() => of(undefined)),
            getOrgBilling: vi.fn(() => of({})),
            getOrgUsage: vi.fn(() => of({})),
            getOrgBillingPortal: vi.fn(() => of({ portal_url: '' })),
            renameOrg: vi.fn(() => of({})),
          },
        },
        { provide: ModelService, useValue: { modelList: vi.fn(() => []) } },
        { provide: AuthService, useValue: { user: authUser } },
        { provide: Dialog, useValue: { open: () => ({ closed: of(true) }) } },
        { provide: CognosToastService, useValue: { notify: vi.fn() } },
        { provide: ErrorService, useValue: { alert: errorAlert } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TeamSettingsComponent);
    component = fixture.componentInstance;
    component['redirect'] = redirect;
    fixture.detectChanges();
    await fixture.whenStable();
    return fixture;
  }

  beforeEach(() => {
    vi.clearAllMocks();
    authUser.set({ id: 'user_me' });
    listOrgs = vi.fn(() => of<OrganisationRecord[]>([]));
    createOrg = vi.fn(() => of(makeOrg()));
    createOrgCheckout = vi.fn(() => of({ checkout_url: 'https://checkout' }));
    errorAlert = vi.fn();
    redirect = vi.fn<(url: string) => void>();
  });

  // ---- Loading / error ------------------------------------------------------

  it('shows loading state initially', async () => {
    listOrgs = vi.fn(() => NEVER);
    await render();
    expect(fixture.nativeElement.textContent).toContain('Loading…');
  });

  it('shows error state when listOrgs fails', async () => {
    listOrgs = vi.fn(() => throwError(() => new Error('boom')));
    await render();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain(
      'Could not load your Organisations. Please try again.',
    );
  });

  // ---- No orgs: create flow -------------------------------------------------

  it('shows create form when user has no organisations', async () => {
    await render();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Create an Organisation');
    expect(fixture.nativeElement.querySelector('form')).not.toBeNull();
  });

  it('does not submit create when name is blank', async () => {
    await render();
    fixture.detectChanges();

    component['name'].set('   ');
    component['create']();

    expect(createOrg).not.toHaveBeenCalled();
  });

  it('creates org and shows checkout CTA on success', async () => {
    await render();
    fixture.detectChanges();

    component['name'].set('New Co');
    component['create']();

    expect(createOrg).toHaveBeenCalledWith({ name: 'New Co' });
    expect(component['createdOrg']()).not.toBeNull();
  });

  it('starts checkout and redirects on success', async () => {
    await render();
    fixture.detectChanges();

    component['name'].set('New Co');
    component['create']();

    component['startCheckout'](component['createdOrg']()!.id);

    expect(createOrgCheckout).toHaveBeenCalledWith(component['createdOrg']()!.id);
    expect(redirect).toHaveBeenCalledWith('https://checkout');
  });

  it('shows error alert when createOrg fails', async () => {
    TestBed.resetTestingModule();
    createOrg = vi.fn(() => throwError(() => new Error('boom')));

    await TestBed.configureTestingModule({
      imports: [TeamSettingsComponent],
      providers: [
        provideRouter([]),
        {
          provide: CognosApiService,
          useValue: {
            listOrgs,
            createOrg,
            createOrgCheckout,
            listOrgMembers: vi.fn(() => of([])),
            removeOrgMember: vi.fn(() => of(undefined)),
            listOrgInvites: vi.fn(() => of([])),
            createOrgInvite: vi.fn(() => of({ token: '' })),
            revokeOrgInvite: vi.fn(() => of(undefined)),
            getOrgBilling: vi.fn(() => of({})),
            getOrgUsage: vi.fn(() => of({})),
            getOrgBillingPortal: vi.fn(() => of({ portal_url: '' })),
            renameOrg: vi.fn(() => of({})),
          },
        },
        { provide: ModelService, useValue: { modelList: vi.fn(() => []) } },
        { provide: AuthService, useValue: { user: authUser } },
        { provide: Dialog, useValue: { open: () => ({ closed: of(true) }) } },
        { provide: CognosToastService, useValue: { notify: vi.fn() } },
        { provide: ErrorService, useValue: { alert: errorAlert } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TeamSettingsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();

    component['name'].set('New Co');
    component['create']();

    expect(errorAlert).toHaveBeenCalled();
  });

  // ---- Member-only orgs -----------------------------------------------------

  it('shows read-only member org list plus create form', async () => {
    listOrgs = vi.fn(() => of([makeOrg({ role: 'member', name: 'Globex' })]));
    await render();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Your Organisations');
    expect(fixture.nativeElement.textContent).toContain('Globex');
    expect(fixture.nativeElement.querySelector('form')).not.toBeNull();
  });

  // ---- Admin orgs: tabs + child components ----------------------------------

  it('shows admin tabs when user owns an org', async () => {
    listOrgs = vi.fn(() => of([makeOrg({ role: 'owner', name: 'Acme' })]));
    await render();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('Members');
    expect(fixture.nativeElement.textContent).toContain('Invites');
    expect(fixture.nativeElement.textContent).toContain('Billing & usage');
    expect(fixture.nativeElement.textContent).toContain('Settings');
  });

  it('defaults to members tab', async () => {
    listOrgs = vi.fn(() => of([makeOrg({ role: 'owner' })]));
    await render();
    fixture.detectChanges();

    expect(component['tab']()).toBe('members');
  });

  it('switches tab on segmented control select', async () => {
    listOrgs = vi.fn(() => of([makeOrg({ role: 'owner' })]));
    await render();
    fixture.detectChanges();

    component['selectTab']('billing');
    fixture.detectChanges();

    expect(component['tab']()).toBe('billing');
  });

  it('shows org picker when user administers multiple orgs', async () => {
    listOrgs = vi.fn(() =>
      of([
        makeOrg({ id: 'o1', role: 'owner', name: 'A' }),
        makeOrg({ id: 'o2', role: 'admin', name: 'B' }),
      ]),
    );
    await render();
    fixture.detectChanges();

    expect(fixture.nativeElement.textContent).toContain('A');
    expect(fixture.nativeElement.textContent).toContain('B');
  });

  it('updates org name in list when onRenamed is called', async () => {
    listOrgs = vi.fn(() => of([makeOrg({ id: 'o1', name: 'Old' })]));
    await render();

    component['onRenamed']({ id: 'o1', name: 'New', role: 'owner', created: '' });

    expect(component['orgs']()[0].name).toBe('New');
  });

  it('does not switch to an invalid tab value', async () => {
    listOrgs = vi.fn(() => of([makeOrg({ role: 'owner' })]));
    await render();

    component['selectTab']('invalid' as never);
    expect(component['tab']()).toBe('members');
  });

  it('does not select an org not in adminOrgs', async () => {
    listOrgs = vi.fn(() => of([makeOrg({ id: 'o1', role: 'owner' })]));
    await render();

    component['selectOrg']('o2');
    expect(component['selectedOrg']()?.id).toBe('o1');
  });
});
