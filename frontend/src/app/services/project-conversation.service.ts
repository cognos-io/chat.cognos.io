import { Injectable, Signal, computed, inject } from '@angular/core';
import { toObservable, toSignal } from '@angular/core/rxjs-interop';

import { EMPTY, Observable, catchError, forkJoin, map, of, switchMap, tap } from 'rxjs';

import { Base64 } from 'js-base64';

import {
  Conversation,
  ConversationData,
  parseConversationData,
  serializeConversationData,
  sortConversationsByUpdated,
} from '../interfaces/conversation';
import { Project, ProjectConversationRecord } from '../interfaces/project';
import { CognosApiService } from './cognos-api.service';
import { ConversationService } from './conversation.service';
import { CryptoService } from './crypto.service';
import { ProjectService } from './project.service';

/**
 * ProjectConversationService owns the conversations that live inside a project.
 *
 * A project conversation is an ordinary conversation whose secret key is
 * wrapped by the project content key (rather than per-participant). Once the
 * keypair is recovered, the conversation is indistinguishable from a standalone
 * one for messaging — so loaded project conversations are merged into
 * ConversationService's store, letting the existing chat view select and
 * message them. They are excluded from the main sidebar (filtered on
 * `record.project`) and surfaced here, grouped by project.
 */
@Injectable({
  providedIn: 'root',
})
export class ProjectConversationService {
  private readonly _crypto = inject(CryptoService);
  private readonly _api = inject(CognosApiService);
  private readonly _conversations = inject(ConversationService);
  private readonly _projects = inject(ProjectService);

  // Driven by ProjectService: whenever the decrypted projects change we
  // (re)load their conversations and merge them into ConversationService, so
  // even a direct visit to a project chat URL resolves the keypair.
  private readonly _loaded: Signal<Conversation[]> = toSignal(
    toObservable(this._projects.orderedProjects).pipe(
      switchMap((projects) => {
        if (projects.length === 0) {
          return of<Conversation[]>([]);
        }
        return forkJoin(
          projects.map((project) =>
            this.fetchForProject(project).pipe(
              catchError(() => of<Conversation[]>([])),
            ),
          ),
        ).pipe(map((lists) => lists.flat()));
      }),
      tap((conversations) => {
        if (conversations.length > 0) {
          this._conversations.upsertConversations(conversations);
        }
      }),
    ),
    { initialValue: [] },
  );

  // Conversations grouped by project id, newest first within each project.
  // Exposed read-only so the sidebar can render per-project chat lists and
  // counts without each consumer rebuilding the grouping.
  readonly byProject = computed(() => {
    const grouped = new Map<string, Conversation[]>();
    for (const conversation of this._loaded()) {
      const projectId = conversation.record.project;
      if (!projectId) continue;
      const list = grouped.get(projectId) ?? [];
      list.push(conversation);
      grouped.set(projectId, list);
    }
    for (const [projectId, list] of grouped) {
      grouped.set(projectId, sortConversationsByUpdated(list));
    }
    return grouped;
  });

  /** conversationsFor returns a signal of the project's conversations,
   *  newest first. */
  conversationsFor(projectId: string): Signal<Conversation[]> {
    return computed(() => this.byProject().get(projectId) ?? []);
  }

  /**
   * create - opens a new conversation inside a project. Generates a fresh
   * conversation keypair, encrypts the title with it, wraps the secret key
   * under the project content key, and persists. The new conversation is
   * merged into ConversationService so navigating to it just works.
   */
  create(project: Project, data: ConversationData): Observable<Conversation> {
    const keyPair = this._crypto.newKeyPair();
    const sharedKey = this._crypto.sharedKey(keyPair.publicKey, keyPair.secretKey);
    const encryptedData = this._crypto.box(serializeConversationData(data), sharedKey);
    const wrappedSecretKey = this._crypto.secretBox(
      keyPair.secretKey,
      project.contentKey,
    );

    return this._api
      .createProjectConversation(project.record.id, {
        data: Base64.fromUint8Array(encryptedData),
        public_key: Base64.fromUint8Array(keyPair.publicKey),
        wrapped_conversation_secret_key: Base64.fromUint8Array(wrappedSecretKey),
      })
      .pipe(
        map((record) => {
          const conversation: Conversation = {
            record: projectConversationRecord(record),
            decryptedData: data,
            keyPair,
          };
          this._conversations.upsertConversations([conversation]);
          return conversation;
        }),
      );
  }

  private fetchForProject(project: Project): Observable<Conversation[]> {
    return this._api.listProjectConversations(project.record.id).pipe(
      map((records) =>
        records
          .map((record) => this.decrypt(project, record))
          .filter(
            (conversation): conversation is Conversation => conversation !== null,
          ),
      ),
      catchError((error) => {
        console.error('Failed to load project conversations', error);
        return EMPTY;
      }),
    );
  }

  private decrypt(
    project: Project,
    record: ProjectConversationRecord,
  ): Conversation | null {
    try {
      const conversationSecretKey = this._crypto.openSecretBox(
        Base64.toUint8Array(record.wrapped_conversation_secret_key),
        project.contentKey,
      );
      const keyPair = this._crypto.keyPairFromSecretKey(conversationSecretKey);
      const sharedKey = this._crypto.sharedKey(keyPair.publicKey, keyPair.secretKey);
      const decryptedData = parseConversationData(
        this._crypto.openBox(Base64.toUint8Array(record.data), sharedKey),
      );
      return { record: projectConversationRecord(record), decryptedData, keyPair };
    } catch (error) {
      console.error('Project conversation decryption failed', error);
      return null;
    }
  }
}

// projectConversationRecord narrows the API record to the ConversationRecord
// shape the rest of the app consumes, keeping the project relation.
function projectConversationRecord(record: ProjectConversationRecord) {
  return {
    id: record.id,
    created: record.created,
    updated: record.updated,
    last_activity_at: record.last_activity_at,
    data: record.data,
    project: record.project,
  };
}
