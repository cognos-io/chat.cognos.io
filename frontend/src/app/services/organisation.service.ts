import { Injectable, InjectionToken, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import {
  EMPTY,
  Observable,
  catchError,
  distinctUntilChanged,
  map,
  of,
  switchMap,
  tap,
} from 'rxjs';

import {
  OrganisationRecord,
  PERSONAL_WORKSPACE,
  WorkspaceId,
} from '@app/interfaces/organisation';
import { Project } from '@app/interfaces/project';

import { environment } from '@environments/environment';

import { AuthService } from './auth.service';
import { CognosApiService } from './cognos-api.service';

// Per-user persistence of the last active Workspace, namespaced like
// trusted-unlock's vault-session keys so multiple accounts on one browser
// never see each other's choice. Value is 'personal' or an org id.
const storagePrefix = 'cognos:workspace:';

/**
 * Build-time gate for Teams/Organisations (environment.featureFlags.team —
 * FALSE in prod until Teams v1 ships). An InjectionToken rather than a direct
 * environment read so tests can exercise both states.
 */
export const TEAM_WORKSPACES_ENABLED = new InjectionToken<boolean>(
  'TEAM_WORKSPACES_ENABLED',
  { factory: () => environment.featureFlags.team },
);

/**
 * OrganisationService owns the account's Org memberships and the active
 * Workspace (Personal ⇄ each Organisation). Switching Workspace changes which
 * Projects are visible and which billing context new work lands in — NOT
 * identity: no re-login, no second unlock (spec §5.2).
 *
 * Failure posture: if memberships can't load, the account safely behaves as
 * personal-only — nothing org-related renders and nothing is blocked.
 */
@Injectable({
  providedIn: 'root',
})
export class OrganisationService {
  private readonly _auth = inject(AuthService);
  private readonly _api = inject(CognosApiService);
  /** Whether Teams/Organisations UI is enabled at build time. */
  readonly enabled = inject(TEAM_WORKSPACES_ENABLED);

  private readonly _memberships = signal<OrganisationRecord[]>([]);
  private readonly _activeWorkspace = signal<WorkspaceId>(PERSONAL_WORKSPACE);
  // The user the current state belongs to; '' when signed out.
  private _userId = '';

  /** Organisations the signed-in Account is an active member of. */
  readonly memberships = this._memberships.asReadonly();

  /** The active Workspace: 'personal' or an org id. */
  readonly activeWorkspace = this._activeWorkspace.asReadonly();

  /** True when the account belongs to at least one Organisation. */
  readonly hasMemberships = computed(() => this._memberships().length > 0);

  /** True when an Organisation (not Personal) is the active Workspace. */
  readonly isOrgWorkspace = computed(
    () => this._activeWorkspace() !== PERSONAL_WORKSPACE,
  );

  /** The active Organisation's membership record, or null in Personal. */
  readonly activeOrg = computed(
    () => this._memberships().find((org) => org.id === this._activeWorkspace()) ?? null,
  );

  constructor() {
    // Follow the signed-in user: on login (or account switch) restore that
    // user's persisted Workspace and load memberships; on logout reset to a
    // clean personal-only state. user$ re-emits on token refresh and profile
    // edits, so changes are keyed on the user id, not the emission.
    this._auth.user$
      .pipe(
        map((user) => (user?.['id'] as string | undefined) ?? ''),
        distinctUntilChanged(),
        switchMap((userId) => {
          this._userId = userId;
          this._memberships.set([]);
          this._activeWorkspace.set(PERSONAL_WORKSPACE);

          if (!userId || !this.enabled) {
            return EMPTY;
          }

          // Restore optimistically; validated against memberships below so a
          // revoked org never sticks as the active Workspace.
          this._activeWorkspace.set(this.readPersistedWorkspace(userId));

          return this._api.listOrgs().pipe(
            map((memberships) => ({ userId, memberships })),
            catchError((error) => {
              console.error('Unable to load org memberships', error);
              // Fail safe: behave as a personal-only account.
              if (this._userId === userId) {
                this._memberships.set([]);
                this._activeWorkspace.set(PERSONAL_WORKSPACE);
              }
              return EMPTY;
            }),
          );
        }),
        takeUntilDestroyed(),
      )
      .subscribe(({ userId, memberships }) => {
        // Ignore a late response for a user who already signed out.
        if (this._userId !== userId) {
          return;
        }
        this._memberships.set(memberships);
        if (!this.isKnownWorkspace(this._activeWorkspace())) {
          this._activeWorkspace.set(PERSONAL_WORKSPACE);
        }
      });
  }

  /**
   * setActiveWorkspace switches the active Workspace. Only 'personal' or an
   * Organisation the account is a member of is accepted; anything else is
   * ignored so a stale id can never select a context the user isn't in.
   * Switching only updates signals — it never navigates, so an in-progress
   * composer draft survives untouched (spec §5.2).
   */
  setActiveWorkspace(workspace: WorkspaceId): void {
    if (!this.isKnownWorkspace(workspace)) {
      return;
    }
    this._activeWorkspace.set(workspace);
    this.persistWorkspace(workspace);
  }

  /**
   * refreshMemberships re-fetches the Org memberships for the signed-in user
   * without waiting for a login event — used right after accepting an invite
   * so the new Organisation becomes switchable immediately. A stale active
   * Workspace (e.g. a revoked org) is dropped back to Personal, same as on
   * login. Errors propagate to the caller; local state is left untouched.
   */
  refreshMemberships(): Observable<OrganisationRecord[]> {
    const userId = this._userId;
    if (!userId || !this.enabled) {
      return of([]);
    }
    return this._api.listOrgs().pipe(
      tap((memberships) => {
        // Ignore a late response for a user who already signed out.
        if (this._userId !== userId) {
          return;
        }
        this._memberships.set(memberships);
        if (!this.isKnownWorkspace(this._activeWorkspace())) {
          this._activeWorkspace.set(PERSONAL_WORKSPACE);
        }
      }),
    );
  }

  /** The Organisation's display name, or null when unknown/not a member. */
  orgName(orgId: string | undefined): string | null {
    if (!orgId) {
      return null;
    }
    return this._memberships().find((org) => org.id === orgId)?.name ?? null;
  }

  /**
   * visibleProjects filters a project list to the active Workspace: Personal
   * shows Projects without an organisation, an org Workspace shows only that
   * Organisation's Projects. With the feature disabled the list passes through
   * untouched, so individual accounts see zero change.
   */
  visibleProjects(projects: Project[]): Project[] {
    if (!this.enabled) {
      return projects;
    }
    const workspace = this._activeWorkspace();
    if (workspace === PERSONAL_WORKSPACE) {
      return projects.filter((project) => !project.record.organisation);
    }
    return projects.filter((project) => project.record.organisation === workspace);
  }

  private isKnownWorkspace(workspace: WorkspaceId): boolean {
    return (
      workspace === PERSONAL_WORKSPACE ||
      this._memberships().some((org) => org.id === workspace)
    );
  }

  private storageKey(userId: string): string {
    return `${storagePrefix}${userId}`;
  }

  private readPersistedWorkspace(userId: string): WorkspaceId {
    try {
      return localStorage.getItem(this.storageKey(userId)) ?? PERSONAL_WORKSPACE;
    } catch {
      return PERSONAL_WORKSPACE;
    }
  }

  private persistWorkspace(workspace: WorkspaceId): void {
    if (!this._userId) {
      return;
    }
    try {
      if (workspace === PERSONAL_WORKSPACE) {
        localStorage.removeItem(this.storageKey(this._userId));
      } else {
        localStorage.setItem(this.storageKey(this._userId), workspace);
      }
    } catch {
      // Storage unavailable (private mode etc.) — the switch still applies
      // for this session; it just won't be remembered.
    }
  }
}
