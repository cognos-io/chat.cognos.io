import { TestBed } from '@angular/core/testing';

import { Subject, throwError } from 'rxjs';

import { OrganisationRecord } from '@app/interfaces/organisation';
import { Project } from '@app/interfaces/project';

import { AuthService, AuthUser } from './auth.service';
import { CognosApiService } from './cognos-api.service';
import { OrganisationService, TEAM_WORKSPACES_ENABLED } from './organisation.service';

const acme: OrganisationRecord = {
  id: 'org_acme',
  name: 'Acme Legal',
  role: 'member',
  created: '2026-07-01 00:00:00.000Z',
  policy_privacy_tier: '',
  policy_retention_days: 0,
  policy_mfa_required: false,
};

const globex: OrganisationRecord = {
  id: 'org_globex',
  name: 'Globex',
  role: 'admin',
  created: '2026-07-02 00:00:00.000Z',
  policy_privacy_tier: '',
  policy_retention_days: 0,
  policy_mfa_required: false,
};

const userAlice: AuthUser = { id: 'user_alice' } as unknown as AuthUser;
const userBob: AuthUser = { id: 'user_bob' } as unknown as AuthUser;

function projectOf(id: string, organisation?: string): Project {
  return {
    record: {
      id,
      created: '',
      updated: '',
      data: '',
      key_version: 1,
      ...(organisation ? { organisation } : {}),
    },
    decryptedData: {
      version: '1',
      name: id,
      description: '',
      icon: 'folder',
      color: 'slate',
      instructions: '',
      defaultModelId: '',
    },
    contentKey: new Uint8Array(32),
  } as Project;
}

describe('OrganisationService', () => {
  let user$: Subject<AuthUser>;
  let listOrgs: ReturnType<typeof vi.fn>;

  function setup(options?: {
    enabled?: boolean;
    memberships?: OrganisationRecord[];
    listOrgsError?: boolean;
  }): OrganisationService {
    user$ = new Subject<AuthUser>();
    listOrgs = vi.fn(() => {
      if (options?.listOrgsError) {
        return throwError(() => new Error('boom'));
      }
      const result$ = new Subject<OrganisationRecord[]>();
      queueMicrotask(() => {
        result$.next(options?.memberships ?? []);
        result$.complete();
      });
      return result$;
    });

    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: { user$ } },
        { provide: CognosApiService, useValue: { listOrgs } },
        { provide: TEAM_WORKSPACES_ENABLED, useValue: options?.enabled ?? true },
      ],
    });

    return TestBed.inject(OrganisationService);
  }

  // Flush the microtask that resolves the mocked listOrgs response.
  const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  beforeEach(() => {
    localStorage.clear();
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it('starts signed-out as personal with no memberships', () => {
    const service = setup();
    expect(service.activeWorkspace()).toBe('personal');
    expect(service.memberships()).toEqual([]);
    expect(service.hasMemberships()).toBe(false);
    expect(service.activeOrg()).toBeNull();
  });

  it('loads memberships once the user signs in', async () => {
    const service = setup({ memberships: [acme, globex] });
    user$.next(userAlice);
    await flush();

    expect(listOrgs).toHaveBeenCalledTimes(1);
    expect(service.memberships()).toEqual([acme, globex]);
    expect(service.hasMemberships()).toBe(true);
    expect(service.activeWorkspace()).toBe('personal');
  });

  it('does not refetch on repeat emissions of the same user (token refresh)', async () => {
    const service = setup({ memberships: [acme] });
    user$.next(userAlice);
    await flush();
    user$.next(userAlice);
    await flush();

    expect(listOrgs).toHaveBeenCalledTimes(1);
    expect(service.memberships()).toEqual([acme]);
  });

  describe('switching', () => {
    it('activates a member org and persists it per user', async () => {
      const service = setup({ memberships: [acme] });
      user$.next(userAlice);
      await flush();

      service.setActiveWorkspace('org_acme');

      expect(service.activeWorkspace()).toBe('org_acme');
      expect(service.isOrgWorkspace()).toBe(true);
      expect(service.activeOrg()).toEqual(acme);
      expect(localStorage.getItem('cognos:workspace:user_alice')).toBe('org_acme');
    });

    it('ignores an org the user is not a member of', async () => {
      const service = setup({ memberships: [acme] });
      user$.next(userAlice);
      await flush();

      service.setActiveWorkspace('org_evil');

      expect(service.activeWorkspace()).toBe('personal');
      expect(localStorage.getItem('cognos:workspace:user_alice')).toBeNull();
    });

    it('switching back to personal clears the persisted choice', async () => {
      const service = setup({ memberships: [acme] });
      user$.next(userAlice);
      await flush();

      service.setActiveWorkspace('org_acme');
      service.setActiveWorkspace('personal');

      expect(service.activeWorkspace()).toBe('personal');
      expect(localStorage.getItem('cognos:workspace:user_alice')).toBeNull();
    });

    it('forgets a dissolved active Organisation and falls back to Personal', async () => {
      const service = setup({ memberships: [acme, globex] });
      user$.next(userAlice);
      await flush();
      service.setActiveWorkspace('org_acme');

      service.forgetMembership('org_acme');

      expect(service.memberships()).toEqual([globex]);
      expect(service.activeWorkspace()).toBe('personal');
      expect(localStorage.getItem('cognos:workspace:user_alice')).toBeNull();
    });

    it('forgets an inactive Organisation without disturbing the active Workspace', async () => {
      const service = setup({ memberships: [acme, globex] });
      user$.next(userAlice);
      await flush();
      service.setActiveWorkspace('org_globex');

      service.forgetMembership('org_acme');

      expect(service.memberships()).toEqual([globex]);
      expect(service.activeWorkspace()).toBe('org_globex');
      expect(localStorage.getItem('cognos:workspace:user_alice')).toBe('org_globex');
    });
  });

  describe('persistence across sessions and users', () => {
    it('restores the persisted workspace for the signing-in user', async () => {
      localStorage.setItem('cognos:workspace:user_alice', 'org_acme');
      const service = setup({ memberships: [acme] });

      user$.next(userAlice);
      await flush();

      expect(service.activeWorkspace()).toBe('org_acme');
    });

    it('falls back to personal when the persisted org is no longer a membership', async () => {
      localStorage.setItem('cognos:workspace:user_alice', 'org_gone');
      const service = setup({ memberships: [acme] });

      user$.next(userAlice);
      await flush();

      expect(service.activeWorkspace()).toBe('personal');
    });

    it('resets to personal on user change; the next user gets their own choice', async () => {
      localStorage.setItem('cognos:workspace:user_bob', 'org_globex');
      const service = setup({ memberships: [acme, globex] });

      user$.next(userAlice);
      await flush();
      service.setActiveWorkspace('org_acme');

      user$.next(userBob);
      await flush();

      // Bob restores Bob's persisted org — never Alice's.
      expect(service.activeWorkspace()).toBe('org_globex');
      expect(localStorage.getItem('cognos:workspace:user_alice')).toBe('org_acme');
    });

    it('resets to a clean personal state on logout', async () => {
      const service = setup({ memberships: [acme] });
      user$.next(userAlice);
      await flush();
      service.setActiveWorkspace('org_acme');

      user$.next(null);

      expect(service.activeWorkspace()).toBe('personal');
      expect(service.memberships()).toEqual([]);
      // The persisted choice survives for the next sign-in.
      expect(localStorage.getItem('cognos:workspace:user_alice')).toBe('org_acme');
    });
  });

  describe('failure and gating', () => {
    it('membership load failure falls back safely to personal-only', async () => {
      localStorage.setItem('cognos:workspace:user_alice', 'org_acme');
      const service = setup({ listOrgsError: true });

      user$.next(userAlice);
      await flush();

      expect(service.memberships()).toEqual([]);
      expect(service.hasMemberships()).toBe(false);
      expect(service.activeWorkspace()).toBe('personal');
    });

    it('feature flag off: never calls the API and stays personal', async () => {
      localStorage.setItem('cognos:workspace:user_alice', 'org_acme');
      const service = setup({ enabled: false, memberships: [acme] });

      user$.next(userAlice);
      await flush();

      expect(listOrgs).not.toHaveBeenCalled();
      expect(service.activeWorkspace()).toBe('personal');
      expect(service.hasMemberships()).toBe(false);
    });
  });

  describe('visibleProjects scoping', () => {
    const personal = projectOf('p_personal');
    const acmeProject = projectOf('p_acme', 'org_acme');
    const globexProject = projectOf('p_globex', 'org_globex');
    const all = [personal, acmeProject, globexProject];

    it('personal workspace shows only projects without an organisation', async () => {
      const service = setup({ memberships: [acme, globex] });
      user$.next(userAlice);
      await flush();

      expect(service.visibleProjects(all)).toEqual([personal]);
    });

    it('an org workspace shows only that organisation’s projects', async () => {
      const service = setup({ memberships: [acme, globex] });
      user$.next(userAlice);
      await flush();

      service.setActiveWorkspace('org_acme');

      expect(service.visibleProjects(all)).toEqual([acmeProject]);
    });

    it('handles an empty list', async () => {
      const service = setup({ memberships: [acme] });
      user$.next(userAlice);
      await flush();

      expect(service.visibleProjects([])).toEqual([]);
    });

    // Pin: with the team flag off the filter is a pass-through. This keeps
    // individual accounts (and any project the backend might already tag with
    // an organisation) rendering EXACTLY as before the feature existed. If
    // this fails after an intentional change, the zero-change guarantee for
    // flag-off builds is being altered — make that a conscious decision.
    it('pin: flag off passes every project through unfiltered', () => {
      const service = setup({ enabled: false });
      expect(service.visibleProjects(all)).toEqual(all);
    });
  });

  describe('orgName', () => {
    it('resolves a membership name and null otherwise', async () => {
      const service = setup({ memberships: [acme] });
      user$.next(userAlice);
      await flush();

      expect(service.orgName('org_acme')).toBe('Acme Legal');
      expect(service.orgName('org_unknown')).toBeNull();
      expect(service.orgName(undefined)).toBeNull();
    });
  });

  describe('refreshMemberships', () => {
    // Sunny (invite accept): the fresh membership becomes switchable without
    // waiting for a re-login.
    it('picks up a new membership so it can be activated immediately', async () => {
      const service = setup({ memberships: [acme] });
      user$.next(userAlice);
      await flush();
      expect(service.memberships()).toEqual([acme]);

      listOrgs.mockImplementation(() => {
        const result$ = new Subject<OrganisationRecord[]>();
        queueMicrotask(() => {
          result$.next([acme, globex]);
          result$.complete();
        });
        return result$;
      });

      await new Promise((resolve, reject) =>
        service
          .refreshMemberships()
          .subscribe({ complete: () => resolve(undefined), error: reject }),
      );

      expect(service.memberships()).toEqual([acme, globex]);
      service.setActiveWorkspace('org_globex');
      expect(service.activeWorkspace()).toBe('org_globex');
    });

    // Rainy: a revoked org that was the active workspace drops to personal.
    it('drops a stale active workspace back to personal', async () => {
      const service = setup({ memberships: [acme, globex] });
      user$.next(userAlice);
      await flush();
      service.setActiveWorkspace('org_globex');

      listOrgs.mockImplementation(() => {
        const result$ = new Subject<OrganisationRecord[]>();
        queueMicrotask(() => {
          result$.next([acme]);
          result$.complete();
        });
        return result$;
      });
      await new Promise((resolve, reject) =>
        service
          .refreshMemberships()
          .subscribe({ complete: () => resolve(undefined), error: reject }),
      );

      expect(service.memberships()).toEqual([acme]);
      expect(service.activeWorkspace()).toBe('personal');
    });

    // Gating: signed out or flag off, it resolves empty without an API call.
    it('resolves empty without calling the API when signed out', async () => {
      const service = setup({ memberships: [acme] });

      const result = await new Promise((resolve, reject) =>
        service.refreshMemberships().subscribe({ next: resolve, error: reject }),
      );

      expect(result).toEqual([]);
      expect(listOrgs).not.toHaveBeenCalled();
    });

    // Rainy: an API failure propagates and leaves current state untouched.
    it('propagates errors and keeps the existing memberships', async () => {
      const service = setup({ memberships: [acme] });
      user$.next(userAlice);
      await flush();

      listOrgs.mockImplementation(() => throwError(() => new Error('boom')));
      await expect(
        new Promise((resolve, reject) =>
          service.refreshMemberships().subscribe({ next: resolve, error: reject }),
        ),
      ).rejects.toThrow('boom');

      expect(service.memberships()).toEqual([acme]);
    });
  });
});
