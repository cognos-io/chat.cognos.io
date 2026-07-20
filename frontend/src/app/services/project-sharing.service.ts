import { Injectable, inject } from '@angular/core';

import {
  Observable,
  catchError,
  concat,
  defaultIfEmpty,
  forkJoin,
  map,
  of,
  switchMap,
  tap,
  throwError,
} from 'rxjs';

import { Base64 } from 'js-base64';

import {
  Project,
  ProjectParticipantRecord,
  ProjectRole,
  serializeProjectData,
} from '@app/interfaces/project';

import { ApiRotateProjectKeyRequest, CognosApiService } from './cognos-api.service';
import { CryptoService } from './crypto.service';
import { ProjectService } from './project.service';

/**
 * The stages of a forward-only project key rotation, in order. 'rotating' is
 * the server-side commit; everything before it leaves the old key fully
 * valid, everything after only re-encrypts client-held metadata.
 */
export type ProjectRotationPhase = 'preparing' | 'rotating' | 'finalising' | 'done';

/**
 * ProjectRotationError carries which phase failed so the UI can be honest
 * about the state: a failure in 'preparing' or 'rotating' means NOTHING
 * changed — the old key stays valid; a failure in 'finalising' means the new
 * key is live but the project metadata still needs re-encrypting (retry via
 * retryFinalise).
 */
export class ProjectRotationError extends Error {
  constructor(
    readonly phase: ProjectRotationPhase,
    override readonly cause: unknown,
  ) {
    super(`Project key rotation failed during ${phase}`);
    this.name = 'ProjectRotationError';
  }
}

// asPhaseError tags an error with the rotation phase it happened in, keeping
// an already-tagged error's original phase (the innermost phase is the truth).
const asPhaseError = (
  phase: ProjectRotationPhase,
  error: unknown,
): ProjectRotationError =>
  error instanceof ProjectRotationError
    ? error
    : new ProjectRotationError(phase, error);

interface PendingFinalise {
  projectId: string;
  newKey: Uint8Array;
}

/**
 * ProjectSharingService implements org-only project sharing (spec §9):
 * listing/adding/revoking participants and the forward-only key rotation that
 * follows a revoke. All key material is handled client-side — the server only
 * ever sees wrapped keys.
 *
 * Rotation is all-or-nothing at the server: the payload must cover EVERY
 * remaining active participant and EVERY project conversation (the server
 * validates completeness), so a rotation can never lock anyone out or orphan
 * a conversation.
 */
@Injectable({
  providedIn: 'root',
})
export class ProjectSharingService {
  private readonly _api = inject(CognosApiService);
  private readonly _crypto = inject(CryptoService);
  private readonly _projects = inject(ProjectService);

  // A rotation whose server-side commit succeeded but whose metadata
  // re-encryption (finalise) still needs a retry. In-memory only — the new
  // key is recoverable from the server via the caller's fresh wrapping, so
  // losing this on reload costs a retry path, not data.
  private _pendingFinalise: PendingFinalise | null = null;

  listParticipants(projectId: string): Observable<ProjectParticipantRecord[]> {
    return this._api.listProjectParticipants(projectId);
  }

  /**
   * addParticipant grants an active org member access to an org-owned
   * project: fetch their Account public key (relationship-gated), seal the
   * CURRENT project content key to it, and register the participant — the
   * server writes both rows transactionally.
   */
  addParticipant(
    project: Project,
    userId: string,
    role: ProjectRole,
  ): Observable<ProjectParticipantRecord> {
    return this._api.getUserPublicKey(userId).pipe(
      switchMap((response) => {
        const wrapped = this._crypto.createSealedBox(
          project.contentKey,
          Base64.toUint8Array(response.public_key),
        );
        return this._api.addProjectParticipant(project.record.id, {
          user_id: userId,
          role,
          wrapped_project_key: Base64.fromUint8Array(wrapped),
        });
      }),
    );
  }

  /** revokeParticipant soft-removes a participant (server-side, creator protected). */
  revokeParticipant(projectId: string, userId: string): Observable<void> {
    return this._api.removeProjectParticipant(projectId, userId);
  }

  /**
   * rotateKey performs the forward-only rotation that should follow every
   * revoke: mint a fresh content key client-side, seal it to EVERY remaining
   * active participant, rewrap EVERY project conversation's secret key under
   * it, commit atomically, then re-encrypt the client-held project metadata
   * (data blob + project memory) under the new key.
   *
   * Emits each phase as it starts, then 'done'. Errors are
   * ProjectRotationError — check `phase` to know whether the old key is
   * still the valid one ('preparing'/'rotating') or only the metadata
   * re-encryption is left ('finalising', retry via retryFinalise).
   */
  rotateKey(project: Project): Observable<ProjectRotationPhase> {
    const projectId = project.record.id;
    return concat(
      of<ProjectRotationPhase>('preparing'),
      this.buildRotationRequest(project).pipe(
        catchError((error: unknown) =>
          throwError(() => asPhaseError('preparing', error)),
        ),
        switchMap(({ newKey, request }) =>
          concat(
            of<ProjectRotationPhase>('rotating'),
            this._api.rotateProjectKey(projectId, request).pipe(
              catchError((error: unknown) =>
                throwError(() => asPhaseError('rotating', error)),
              ),
              switchMap(() => {
                this._pendingFinalise = { projectId, newKey };
                return concat(
                  of<ProjectRotationPhase>('finalising'),
                  this.finalise(project, newKey).pipe(
                    map(() => 'done' as ProjectRotationPhase),
                    catchError((error: unknown) =>
                      throwError(() => asPhaseError('finalising', error)),
                    ),
                  ),
                );
              }),
            ),
          ),
        ),
      ),
    );
  }

  /** True when a committed rotation for this project still needs finalising. */
  hasPendingFinalise(projectId: string): boolean {
    return this._pendingFinalise?.projectId === projectId;
  }

  /**
   * retryFinalise re-runs only the metadata re-encryption of a rotation whose
   * server-side commit already succeeded (the new key IS the live key).
   */
  retryFinalise(project: Project): Observable<ProjectRotationPhase> {
    const pending = this._pendingFinalise;
    if (!pending || pending.projectId !== project.record.id) {
      return throwError(
        () => new ProjectRotationError('finalising', new Error('No pending rotation')),
      );
    }
    return concat(
      of<ProjectRotationPhase>('finalising'),
      this.finalise(project, pending.newKey).pipe(
        map(() => 'done' as ProjectRotationPhase),
        catchError((error: unknown) =>
          throwError(() => asPhaseError('finalising', error)),
        ),
      ),
    );
  }

  // buildRotationRequest assembles the complete client-side payload:
  // a fresh key sealed to every active participant's public key, and every
  // project conversation's secret key rewrapped under the fresh key. Any
  // failure here aborts before the server is touched (old key stays valid).
  private buildRotationRequest(
    project: Project,
  ): Observable<{ newKey: Uint8Array; request: ApiRotateProjectKeyRequest }> {
    const projectId = project.record.id;
    return forkJoin({
      participants: this._api.listProjectParticipants(projectId),
      conversations: this._api.listProjectConversations(projectId),
    }).pipe(
      switchMap(({ participants, conversations }) => {
        if (participants.length === 0) {
          return throwError(
            () =>
              new ProjectRotationError(
                'preparing',
                new Error('Project has no active participants'),
              ),
          );
        }
        return forkJoin(
          participants.map((participant) =>
            this._api.getUserPublicKey(participant.user_id).pipe(
              map((response) => ({
                userId: participant.user_id,
                publicKey: Base64.toUint8Array(response.public_key),
              })),
            ),
          ),
        ).pipe(
          map((participantKeys) => {
            const newKey = this._crypto.randomKey();
            const wrappedProjectKeys = participantKeys.map(({ userId, publicKey }) => ({
              user_id: userId,
              wrapped_project_key: Base64.fromUint8Array(
                this._crypto.createSealedBox(newKey, publicKey),
              ),
            }));
            const rewrappedConversationKeys = conversations.map((conversation) => {
              const secretKey = this._crypto.openSecretBox(
                Base64.toUint8Array(conversation.wrapped_conversation_secret_key),
                project.contentKey,
              );
              return {
                conversation_id: conversation.id,
                wrapped_secret_key: Base64.fromUint8Array(
                  this._crypto.secretBox(secretKey, newKey),
                ),
              };
            });
            const currentVersion = Math.max(1, project.record.key_version || 1);
            return {
              newKey,
              request: {
                new_key_version: currentVersion + 1,
                wrapped_project_keys: wrappedProjectKeys,
                rewrapped_conversation_keys: rewrappedConversationKeys,
              },
            };
          }),
        );
      }),
    );
  }

  // finalise re-encrypts client-held metadata under the new key: the project
  // data blob (name/description/instructions) and any project memory records.
  // Idempotent — a retry after partial success re-encrypts from plaintext and
  // skips memory records already migrated.
  private finalise(project: Project, newKey: Uint8Array): Observable<void> {
    const projectId = project.record.id;
    const encryptedData = this._crypto.secretBox(
      serializeProjectData(project.decryptedData),
      newKey,
    );
    return this._api
      .updateProject(projectId, { data: Base64.fromUint8Array(encryptedData) })
      .pipe(
        switchMap((record) =>
          this.reencryptProjectMemory(project, newKey).pipe(
            tap(() => {
              this._projects.applyKeyRotation(projectId, newKey, record);
              this._pendingFinalise = null;
            }),
          ),
        ),
      );
  }

  // reencryptProjectMemory migrates project memory blobs (encrypted under the
  // project content key, see ScopedMemoryService) to the new key. Records that
  // no longer open with the old key are skipped: they are either already
  // migrated (a finalise retry) or stale-undecryptable, and neither should
  // block the rotation.
  private reencryptProjectMemory(
    project: Project,
    newKey: Uint8Array,
  ): Observable<void> {
    return this._api.listProjectMemory(project.record.id).pipe(
      switchMap((records) => {
        const updates = records.flatMap((record) => {
          let plaintext: Uint8Array;
          try {
            plaintext = this._crypto.openSecretBox(
              Base64.toUint8Array(record.data),
              project.contentKey,
            );
          } catch {
            return [];
          }
          const reencrypted = Base64.fromUint8Array(
            this._crypto.secretBox(plaintext, newKey),
          );
          return [this._api.updateProjectMemory(record.id, reencrypted)];
        });
        if (updates.length === 0) {
          return of(void 0);
        }
        return forkJoin(updates).pipe(map(() => void 0));
      }),
      defaultIfEmpty(void 0),
    );
  }
}
