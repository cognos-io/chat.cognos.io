import { Injectable, inject } from '@angular/core';
import { Router } from '@angular/router';

import {
  EMPTY,
  Observable,
  Subject,
  catchError,
  forkJoin,
  from,
  map,
  of,
  switchMap,
  tap,
  throwError,
} from 'rxjs';

import { Base64 } from 'js-base64';
import { signalSlice } from 'ngxtension/signal-slice';

import { KeyPair } from '../interfaces/key-pair';
import {
  Project,
  ProjectData,
  ProjectRecord,
  parseProjectData,
  serializeProjectData,
  sortProjectsByUpdated,
} from '../interfaces/project';
import { AuthService } from './auth.service';
import { CognosApiService } from './cognos-api.service';
import { CryptoService } from './crypto.service';
import { VaultService } from './vault.service';

export const UserKeyPairNotFoundError = new Error('User key pair not found');

interface ProjectState {
  projects: Array<Project>;
  selectedProjectId: string;
}

const initialState: ProjectState = {
  projects: [],
  selectedProjectId: '',
};

@Injectable({
  providedIn: 'root',
})
export class ProjectService {
  private readonly _cryptoService = inject(CryptoService);
  private readonly _vaultService = inject(VaultService);
  private readonly _auth = inject(AuthService);
  private readonly _api = inject(CognosApiService);
  private readonly _router = inject(Router);

  // sources
  readonly newProject$ = new Subject<ProjectData>();
  readonly deleteProject$ = new Subject<string>(); // projectId

  private state = signalSlice({
    initialState,
    sources: [
      // Clear project state when the user logs out.
      this._auth.logout$.pipe(map(() => initialState)),
      // Reload (or clear) projects whenever the user's key pair changes —
      // unlocking the vault makes decryption possible; locking clears it.
      this._vaultService.keyPair$.pipe(
        switchMap((keyPair) => {
          if (!keyPair) {
            return of(initialState);
          }
          return this.fetchProjects().pipe(map((projects) => ({ projects })));
        }),
      ),
      // Create a project when newProject emits.
      (state) =>
        this.newProject$.pipe(
          switchMap((data) =>
            this.createProject(data).pipe(
              catchError((error) => {
                console.error(error);
                return EMPTY;
              }),
              tap((project) => {
                this._router.navigate(['/account/projects', project.record.id]);
              }),
              map((project) => ({
                selectedProjectId: project.record.id,
                projects: [project, ...state().projects],
              })),
            ),
          ),
        ),
      // Delete a project when deleteProject emits.
      (state) =>
        this.deleteProject$.pipe(
          switchMap((projectId) =>
            this._api.deleteProject(projectId).pipe(
              catchError((error) => {
                console.error(error);
                return EMPTY;
              }),
              map(() => {
                let selectedProjectId = state().selectedProjectId;
                if (projectId === selectedProjectId) {
                  selectedProjectId = '';
                }
                return {
                  projects: state().projects.filter(
                    (project) => project.record.id !== projectId,
                  ),
                  selectedProjectId,
                };
              }),
            ),
          ),
        ),
    ],
    selectors: (state) => ({
      orderedProjects: () => sortProjectsByUpdated(state.projects()),
      selectedProject: () =>
        state
          .projects()
          .find((project) => project.record.id === state.selectedProjectId()) ?? null,
    }),
    actionSources: {
      selectProject: (_state, $: Observable<string>) =>
        $.pipe(map((selectedProjectId) => ({ selectedProjectId }))),
      // Replaces a single project in the list after an in-place edit.
      replaceProject: (state, $: Observable<Project>) =>
        $.pipe(
          map((updated) => ({
            projects: state().projects.map((project) =>
              project.record.id === updated.record.id ? updated : project,
            ),
          })),
        ),
    },
  });

  // public, read-only signals
  readonly projects = this.state.projects;
  readonly orderedProjects = this.state.orderedProjects;
  readonly selectedProject = this.state.selectedProject;
  readonly selectedProjectId = this.state.selectedProjectId;

  select(projectId: string): void {
    this.state.selectProject(projectId);
  }

  /**
   * updateProject - re-encrypts the project metadata under the project's
   * existing content key and persists it. Returns the updated Project.
   */
  updateProject(projectId: string, data: ProjectData): Observable<Project> {
    const existing = this.projects().find((project) => project.record.id === projectId);
    if (!existing) {
      return throwError(() => new Error(`Project ${projectId} not loaded`));
    }

    const encryptedData = this._cryptoService.secretBox(
      serializeProjectData(data),
      existing.contentKey,
    );

    return this._api
      .updateProject(projectId, { data: Base64.fromUint8Array(encryptedData) })
      .pipe(
        map((record) => {
          const updated: Project = {
            record,
            decryptedData: data,
            contentKey: existing.contentKey,
          };
          this.state.replaceProject(updated);
          return updated;
        }),
      );
  }

  /**
   * createProject - generates a fresh project content key, encrypts the
   * metadata under it, seals the key to the creator's own public key, and
   * persists all three to the backend (the server writes them transactionally).
   */
  private createProject(data: ProjectData): Observable<Project> {
    const userKeyPair = this._vaultService.keyPair();
    if (!userKeyPair?.publicKey || !userKeyPair?.secretKey) {
      return throwError(() => UserKeyPairNotFoundError);
    }

    const contentKey = this._cryptoService.randomKey();
    const encryptedData = this._cryptoService.secretBox(
      serializeProjectData(data),
      contentKey,
    );
    const wrappedKey = this._cryptoService.createSealedBox(
      contentKey,
      userKeyPair.publicKey,
    );

    return this._api
      .createProject({
        data: Base64.fromUint8Array(encryptedData),
        wrapped_project_key: Base64.fromUint8Array(wrappedKey),
      })
      .pipe(
        map((record) => ({
          record,
          decryptedData: data,
          contentKey,
        })),
      );
  }

  private fetchProjects(): Observable<Array<Project>> {
    const userKeyPair = this._vaultService.keyPair();
    if (!userKeyPair?.secretKey) {
      return of([]);
    }

    return this._api.listProjects().pipe(
      switchMap((records) => {
        if (records.length === 0) {
          return of<Array<Project>>([]);
        }
        return forkJoin(
          records.map((record) => this.decryptProject(record, userKeyPair)),
        ).pipe(map((projects) => projects.filter((p): p is Project => p !== null)));
      }),
    );
  }

  /**
   * decryptProject - opens a project's wrapped content key with the user's
   * key pair, then decrypts the metadata. A project with no wrapper for this
   * user (or that fails to decrypt) is skipped rather than failing the whole
   * list.
   */
  private decryptProject(
    record: ProjectRecord,
    userKeyPair: KeyPair,
  ): Observable<Project | null> {
    return from(
      (async (): Promise<Project | null> => {
        if (!record.wrapped_project_key) {
          return null;
        }
        const contentKey = this._cryptoService.openSealedBox(
          Base64.toUint8Array(record.wrapped_project_key),
          userKeyPair,
        );
        const decryptedData = parseProjectData(
          this._cryptoService.openSecretBox(
            Base64.toUint8Array(record.data),
            contentKey,
          ),
        );
        return { record, decryptedData, contentKey };
      })(),
    ).pipe(
      catchError((error) => {
        console.error('Project decryption failed', error);
        return of(null);
      }),
    );
  }
}
