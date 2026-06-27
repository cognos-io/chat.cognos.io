import { Injectable, effect, inject, signal } from '@angular/core';

import { Observable, catchError, defer, map, of, switchMap, throwError } from 'rxjs';

import { Base64 } from 'js-base64';

import { Conversation } from '@app/interfaces/conversation';
import { KeyPair } from '@app/interfaces/key-pair';
import {
  RedactionCandidate,
  RedactionEntry,
  RedactionSource,
  applyRedactions,
  buildCustomCandidates,
  defaultTokenGenerator,
  detectSensitiveText,
  hydrateRedactedText,
  resolveOverlaps,
} from '@app/redaction';

import { AuthService } from './auth.service';
import { CognosApiService } from './cognos-api.service';
import { ConversationService } from './conversation.service';
import { CryptoService } from './crypto.service';
import { UserPreferencesService } from './user-preferences.service';
import { VaultService } from './vault.service';

const NoUserKeyPairError = new Error('User key pair not available');

const isNotFound = (err: unknown): boolean =>
  typeof err === 'object' &&
  err !== null &&
  (err as { status?: number }).status === 404;

// Per-conversation redaction state held in memory after decryption.
interface ConversationRedaction {
  // The conversation's redaction keypair, decrypted from the caller's wrapped
  // secret. Null until a redaction key exists for the conversation.
  keyPair: KeyPair | null;
  keyVersion: number;
  // token -> decrypted entry, for hydration.
  entries: Map<string, RedactionEntry>;
}

/**
 * RedactionService is the Angular boundary around the pure redaction engine
 * (`@app/redaction`). It owns the per-conversation redaction key and the
 * encrypted token→original mappings, and exposes:
 *
 *   - detect(): preview candidates for the composer (pure, no I/O),
 *   - prepareRedaction(): swap selected values for tokens before send (pure),
 *   - persist(): seal new mappings and store them under the redaction key,
 *   - hydrate(): restore originals for display for an authorised viewer.
 *
 * Security invariants (spec §17):
 *   - the redaction keypair is independent of the conversation key and its
 *     secret is sealed to each participant's PERSONAL key, so a redacted-only
 *     public reader (who only holds the conversation key) can never open it;
 *   - raw originals and decrypted payloads are never logged.
 */
@Injectable({
  providedIn: 'root',
})
export class RedactionService {
  private readonly _api = inject(CognosApiService);
  private readonly _crypto = inject(CryptoService);
  private readonly _vault = inject(VaultService);
  private readonly _auth = inject(AuthService);
  private readonly _conversationService = inject(ConversationService);
  private readonly _userPreferences = inject(UserPreferencesService);

  private readonly _state = new Map<string, ConversationRedaction>();
  private _loadedConversationId: string | null = null;

  // User-scoped redaction: token→original sealed to the user's own key (no
  // separate keypair). Loaded once; merged into hydration everywhere (spec §16).
  private readonly _userEntries = new Map<string, RedactionEntry>();
  private _userLoaded = false;

  // Project-scoped redaction: a per-project redaction keypair (independent of the
  // content key) + decrypted entries, merged into hydration for the project's
  // conversations.
  private readonly _projectState = new Map<
    string,
    { keyPair: KeyPair | null; entries: Map<string, RedactionEntry> }
  >();
  private _loadedProjectId: string | null = null;

  // Whether redaction is active for new messages. On by default (secure by
  // default); the user can turn it off in settings for all future messages.
  readonly enabled = this._userPreferences.redactionEnabled;

  // Bumped whenever decrypted entries change, so templates can recompute
  // hydrated content reactively without threading the Map through signals.
  readonly revision = signal(0);

  // When true, rendered messages mask their redacted values instead of showing
  // the decrypted originals — for screen sharing or showing the chat to someone
  // else without leaking sensitive data. Transient (never persisted): the owner
  // always sees their own values again on reload.
  readonly valuesHidden = signal(false);

  toggleValuesHidden(): void {
    this.valuesHidden.update((hidden) => !hidden);
  }

  // Load and decrypt a conversation's mappings as soon as it becomes active, so
  // hydration is ready by the time messages render.
  private readonly _autoLoad = effect(() => {
    const conversation = this._conversationService.conversation();
    const id = conversation?.record.id ?? null;
    if (!conversation || id === this._loadedConversationId) {
      return;
    }
    this._loadedConversationId = id;
    const swallow = {
      error: () => {
        // A failed load leaves placeholders visible rather than breaking the
        // conversation view (spec §17 reliability).
      },
    };
    this.loadConversation(conversation).subscribe(swallow);

    // User redaction follows the user everywhere; load it once. Project
    // redaction loads when a project conversation becomes active.
    if (!this._userLoaded) {
      this._userLoaded = true;
      this.loadUserRedaction().subscribe(swallow);
    }
    const projectId = conversation.record.project ?? null;
    if (projectId && projectId !== this._loadedProjectId) {
      this._loadedProjectId = projectId;
      this.loadProjectRedaction(projectId).subscribe(swallow);
    }
  });

  /** Tier 1 high-confidence detection for composer preview. Pure, no I/O. */
  detect(text: string): RedactionCandidate[] {
    return detectSensitiveText(text);
  }

  /**
   * Replace the selected candidates in `text` with stable placeholder tokens,
   * reusing any tokens already known for the conversation. Pure and synchronous
   * — the resulting `newEntries` are persisted separately via {@link persist}.
   * A null conversationId (a brand-new conversation) starts from an empty token
   * map.
   */
  prepareRedaction(
    conversationId: string | null,
    text: string,
    selected?: RedactionCandidate[],
    source?: RedactionSource,
  ): { redactedText: string; newEntries: RedactionEntry[] } {
    const candidates = selected ?? detectSensitiveText(text);
    if (candidates.length === 0) {
      return { redactedText: text, newEntries: [] };
    }
    const existing = conversationId
      ? Array.from(this._state.get(conversationId)?.entries.values() ?? [])
      : [];
    const result = applyRedactions(
      text,
      candidates,
      existing,
      defaultTokenGenerator,
      source,
    );
    return { redactedText: result.redactedText, newEntries: result.newEntries };
  }

  /**
   * Redact text extracted from a user-uploaded attachment before it reaches the
   * provider. Attachment text is untrusted user content just like the prompt
   * (spec docs/specs/attachments.md §9.5), so detected sensitive values are
   * tokenised with the same engine. Token reuse spans the conversation's stored
   * entries, `carryEntries` (tokens just minted for the message body or earlier
   * attachments in the same send), and the conversation's manual `customValues`
   * — so one value collapses to one placeholder everywhere it appears. Pure and
   * synchronous; the resulting `newEntries` are persisted by the caller.
   */
  prepareAttachmentText(
    conversationId: string | null,
    text: string,
    carryEntries: readonly RedactionEntry[] = [],
    customValues: readonly string[] = [],
    source?: RedactionSource,
  ): { redactedText: string; newEntries: RedactionEntry[] } {
    const auto = detectSensitiveText(text);
    const custom = buildCustomCandidates(text, customValues);
    const candidates = resolveOverlaps([...auto, ...custom]);
    if (candidates.length === 0) {
      return { redactedText: text, newEntries: [] };
    }
    const existing = [
      ...(conversationId
        ? Array.from(this._state.get(conversationId)?.entries.values() ?? [])
        : []),
      ...carryEntries,
    ];
    const result = applyRedactions(
      text,
      candidates,
      existing,
      defaultTokenGenerator,
      source,
    );
    return { redactedText: result.redactedText, newEntries: result.newEntries };
  }

  /**
   * Load and decrypt the redaction key and mappings for a conversation. A
   * missing key (404) is a normal state — the conversation has never used
   * redaction — and resolves to an empty mapping rather than an error.
   */
  loadConversation(conversation: Conversation): Observable<void> {
    const conversationId = conversation.record.id;
    return this._api.getRedactionKey(conversationId).pipe(
      switchMap((res) => {
        const keyPair = this.unwrapKeyPair(res.public_key, res.wrapped_secret_key);
        return this._api.listRedactionEntries(conversationId).pipe(
          map((entriesRes) => {
            const entries = new Map<string, RedactionEntry>();
            for (const item of entriesRes.items) {
              const entry = this.tryDecryptEntry(item.data, keyPair);
              if (entry) {
                entries.set(entry.token, entry);
              }
            }
            this.setState(conversationId, {
              keyPair,
              keyVersion: res.key_version,
              entries,
            });
          }),
        );
      }),
      catchError((err) => {
        if (isNotFound(err)) {
          this.setState(conversationId, {
            keyPair: null,
            keyVersion: 1,
            entries: new Map(),
          });
          return of(undefined);
        }
        return throwError(() => err);
      }),
    );
  }

  /**
   * Seal and persist new mappings for a conversation, creating the redaction
   * key on first use (sealed to the caller's personal key). Updates the
   * in-memory mapping so the new tokens hydrate immediately.
   */
  persist(
    conversation: Conversation,
    newEntries: RedactionEntry[],
    source?: RedactionSource,
  ): Observable<void> {
    if (newEntries.length === 0) {
      return of(undefined);
    }
    const conversationId = conversation.record.id;

    return this.ensureKeyPair(conversation).pipe(
      switchMap((keyPair) => {
        const apiEntries = newEntries.map((entry) => ({
          token: entry.token,
          data: this.sealEntry(entry, keyPair),
          source_kind: source?.kind ?? 'message',
          source_id: source?.id,
        }));
        return this._api
          .createRedactionEntries(conversationId, { entries: apiEntries })
          .pipe(
            map(() => {
              const state = this._state.get(conversationId);
              if (state) {
                for (const entry of newEntries) {
                  state.entries.set(entry.token, entry);
                }
                this.revision.update((v) => v + 1);
              }
            }),
          );
      }),
    );
  }

  /**
   * The decrypted token→entry map for a conversation, for renderers that show
   * each redacted span as a pill rather than flattening to plain text. Empty
   * when nothing is loaded.
   */
  entriesFor(
    conversationId: string | null | undefined,
  ): ReadonlyMap<string, RedactionEntry> {
    if (!conversationId) {
      return new Map();
    }
    return this._state.get(conversationId)?.entries ?? new Map();
  }

  /**
   * Original values the user manually redacted earlier in this conversation, so
   * the same value is auto-redacted in future messages without re-selecting it.
   * Read `revision()` first in any reactive consumer (the map loads async).
   */
  customRedactionValues(conversationId: string | null | undefined): string[] {
    const entries = this.entriesFor(conversationId);
    const values = new Set<string>();
    for (const entry of entries.values()) {
      if (entry.type === 'custom') {
        values.add(entry.original);
      }
    }
    return [...values];
  }

  /**
   * Restore originals for known tokens. Display-only; never mutates stored data.
   * Resolves a token against the union of the conversation, its project (when
   * given), and the user — so placeholders pinned to any scope hydrate (spec §16).
   */
  hydrate(
    conversationId: string | null | undefined,
    text: string,
    projectId?: string | null,
  ): string {
    const entries = this.combinedEntries(conversationId, projectId);
    if (entries.length === 0) {
      return text;
    }
    return hydrateRedactedText(text, entries);
  }

  /**
   * The merged token→entry map across the conversation, its project, and the
   * user, for renderers that show each redacted span as a pill (spec §16).
   */
  combinedEntriesFor(
    conversationId: string | null | undefined,
    projectId?: string | null,
  ): ReadonlyMap<string, RedactionEntry> {
    const merged = new Map<string, RedactionEntry>();
    // User + project first; the conversation's own entries win on the (negligible)
    // chance of a token collision.
    for (const entry of this._userEntries.values()) {
      merged.set(entry.token, entry);
    }
    if (projectId) {
      for (const entry of this._projectState.get(projectId)?.entries.values() ?? []) {
        merged.set(entry.token, entry);
      }
    }
    if (conversationId) {
      for (const entry of this._state.get(conversationId)?.entries.values() ?? []) {
        merged.set(entry.token, entry);
      }
    }
    return merged;
  }

  private combinedEntries(
    conversationId: string | null | undefined,
    projectId?: string | null,
  ): RedactionEntry[] {
    return Array.from(this.combinedEntriesFor(conversationId, projectId).values());
  }

  /**
   * The conversation's redaction keypair, loading it if needed. Resolves to
   * null when the conversation has no redaction key (never used redaction) —
   * the caller (e.g. public sharing) then has nothing sensitive to include.
   */
  keyPairFor(conversation: Conversation): Observable<KeyPair | null> {
    const conversationId = conversation.record.id;
    const cached = this._state.get(conversationId)?.keyPair;
    if (cached) {
      return of(cached);
    }
    return this.fetchKeyPair(conversationId).pipe(
      map((keyPair) => {
        this.cacheKeyPair(conversationId, keyPair);
        return keyPair;
      }),
      catchError((err) => (isNotFound(err) ? of(null) : throwError(() => err))),
    );
  }

  // --- scoped (user/project) redaction -------------------------------------

  /** Load + decrypt the user's redaction entries (sealed to the user's key). */
  loadUserRedaction(): Observable<void> {
    const userKeyPair = this._vault.keyPair();
    if (!userKeyPair) {
      return of(undefined);
    }
    return this._api.listUserRedactionEntries().pipe(
      map((res) => {
        this._userEntries.clear();
        for (const item of res.items) {
          const entry = this.tryDecryptEntry(item.data, userKeyPair);
          if (entry) {
            this._userEntries.set(entry.token, entry);
          }
        }
        this.revision.update((v) => v + 1);
      }),
      catchError((err) => (isNotFound(err) ? of(undefined) : throwError(() => err))),
    );
  }

  /** Redact a snippet against the user scope (reusing the user's tokens). */
  prepareUserRedaction(text: string): {
    redactedText: string;
    newEntries: RedactionEntry[];
  } {
    return this.prepareAgainst(text, Array.from(this._userEntries.values()));
  }

  /** Seal + persist new user-scoped mappings (sealed to the user's own key). */
  persistUserRedaction(newEntries: RedactionEntry[]): Observable<void> {
    if (newEntries.length === 0) {
      return of(undefined);
    }
    const userKeyPair = this._vault.keyPair();
    if (!userKeyPair) {
      return throwError(() => NoUserKeyPairError);
    }
    const apiEntries = newEntries.map((entry) => ({
      token: entry.token,
      data: this.sealEntry(entry, userKeyPair),
      source_kind: 'message' as const,
    }));
    return this._api.createUserRedactionEntries({ entries: apiEntries }).pipe(
      map(() => {
        for (const entry of newEntries) {
          this._userEntries.set(entry.token, entry);
        }
        this.revision.update((v) => v + 1);
      }),
    );
  }

  /** Load + decrypt a project's redaction key + entries. */
  loadProjectRedaction(projectId: string): Observable<void> {
    return this._api.getProjectRedactionKey(projectId).pipe(
      switchMap((res) => {
        const keyPair = this.unwrapKeyPair(res.public_key, res.wrapped_secret_key);
        return this._api.listProjectRedactionEntries(projectId).pipe(
          map((entriesRes) => {
            const entries = new Map<string, RedactionEntry>();
            for (const item of entriesRes.items) {
              const entry = this.tryDecryptEntry(item.data, keyPair);
              if (entry) {
                entries.set(entry.token, entry);
              }
            }
            this._projectState.set(projectId, { keyPair, entries });
            this.revision.update((v) => v + 1);
          }),
        );
      }),
      catchError((err) => {
        if (isNotFound(err)) {
          this._projectState.set(projectId, { keyPair: null, entries: new Map() });
          this.revision.update((v) => v + 1);
          return of(undefined);
        }
        return throwError(() => err);
      }),
    );
  }

  /** Redact a snippet against a project scope (reusing the project's tokens). */
  prepareProjectRedaction(
    projectId: string,
    text: string,
  ): { redactedText: string; newEntries: RedactionEntry[] } {
    return this.prepareAgainst(
      text,
      Array.from(this._projectState.get(projectId)?.entries.values() ?? []),
    );
  }

  /** Seal + persist new project-scoped mappings under the project redaction key. */
  persistProjectRedaction(
    projectId: string,
    newEntries: RedactionEntry[],
  ): Observable<void> {
    if (newEntries.length === 0) {
      return of(undefined);
    }
    return this.ensureProjectKeyPair(projectId).pipe(
      switchMap((keyPair) => {
        const apiEntries = newEntries.map((entry) => ({
          token: entry.token,
          data: this.sealEntry(entry, keyPair),
          source_kind: 'message' as const,
        }));
        return this._api
          .createProjectRedactionEntries(projectId, { entries: apiEntries })
          .pipe(
            map(() => {
              const state = this._projectState.get(projectId) ?? {
                keyPair,
                entries: new Map<string, RedactionEntry>(),
              };
              for (const entry of newEntries) {
                state.entries.set(entry.token, entry);
              }
              state.keyPair = keyPair;
              this._projectState.set(projectId, state);
              this.revision.update((v) => v + 1);
            }),
          );
      }),
    );
  }

  private prepareAgainst(
    text: string,
    existing: RedactionEntry[],
  ): { redactedText: string; newEntries: RedactionEntry[] } {
    const candidates = detectSensitiveText(text);
    if (candidates.length === 0) {
      return { redactedText: text, newEntries: [] };
    }
    const result = applyRedactions(text, candidates, existing, defaultTokenGenerator);
    return { redactedText: result.redactedText, newEntries: result.newEntries };
  }

  // ensureProjectKeyPair returns a project's redaction keypair, creating it on
  // first use (wrapped to the caller; other members gain access when participant
  // re-wrapping lands — the same MVP limitation conversations have).
  private ensureProjectKeyPair(projectId: string): Observable<KeyPair> {
    const cached = this._projectState.get(projectId)?.keyPair;
    if (cached) {
      return of(cached);
    }
    return this.fetchProjectKeyPair(projectId).pipe(
      catchError((err) =>
        isNotFound(err) ? this.createProjectKeyPair(projectId) : throwError(() => err),
      ),
      map((keyPair) => {
        const state = this._projectState.get(projectId) ?? {
          keyPair: null,
          entries: new Map<string, RedactionEntry>(),
        };
        state.keyPair = keyPair;
        this._projectState.set(projectId, state);
        return keyPair;
      }),
    );
  }

  private fetchProjectKeyPair(projectId: string): Observable<KeyPair> {
    return this._api
      .getProjectRedactionKey(projectId)
      .pipe(map((res) => this.unwrapKeyPair(res.public_key, res.wrapped_secret_key)));
  }

  private createProjectKeyPair(projectId: string): Observable<KeyPair> {
    return defer(() => {
      const userKeyPair = this._vault.keyPair();
      const userId = this._auth.user()?.['id'] as string | undefined;
      if (!userKeyPair || !userId) {
        return throwError(() => NoUserKeyPairError);
      }
      const redactionKeyPair = this._crypto.newKeyPair();
      const wrapped = this._crypto.createSealedBox(
        redactionKeyPair.secretKey,
        userKeyPair.publicKey,
      );
      return this._api
        .createProjectRedactionKey(projectId, {
          public_key: Base64.fromUint8Array(redactionKeyPair.publicKey),
          keys: [
            { user_id: userId, wrapped_secret_key: Base64.fromUint8Array(wrapped) },
          ],
        })
        .pipe(
          map(() => redactionKeyPair),
          catchError((err) =>
            (err as { status?: number })?.status === 409
              ? this.fetchProjectKeyPair(projectId)
              : throwError(() => err),
          ),
        );
    });
  }

  // --- key management ------------------------------------------------------

  // ensureKeyPair returns the conversation's redaction keypair, creating and
  // storing it on first use. Create-once: a 409 from a racing sender means
  // another client won, so we refetch and use the existing key.
  private ensureKeyPair(conversation: Conversation): Observable<KeyPair> {
    const conversationId = conversation.record.id;
    const cached = this._state.get(conversationId)?.keyPair;
    if (cached) {
      return of(cached);
    }

    return this.fetchKeyPair(conversationId).pipe(
      catchError((err) =>
        isNotFound(err) ? this.createKeyPair(conversation) : throwError(() => err),
      ),
      map((keyPair) => {
        this.cacheKeyPair(conversationId, keyPair);
        return keyPair;
      }),
    );
  }

  private fetchKeyPair(conversationId: string): Observable<KeyPair> {
    return this._api
      .getRedactionKey(conversationId)
      .pipe(map((res) => this.unwrapKeyPair(res.public_key, res.wrapped_secret_key)));
  }

  private createKeyPair(conversation: Conversation): Observable<KeyPair> {
    return defer(() => {
      const userKeyPair = this._vault.keyPair();
      const userId = this._auth.user()?.['id'] as string | undefined;
      if (!userKeyPair || !userId) {
        return throwError(() => NoUserKeyPairError);
      }
      const redactionKeyPair = this._crypto.newKeyPair();
      // MVP: wrap for the current user only. Other participants gain mapping
      // access when participant-add integration lands (spec §11.3); until then
      // they see placeholders. The secret is sealed to the user's PERSONAL key,
      // so holding the conversation key alone never unlocks it.
      const wrapped = this._crypto.createSealedBox(
        redactionKeyPair.secretKey,
        userKeyPair.publicKey,
      );
      return this._api
        .createRedactionKey(conversation.record.id, {
          public_key: Base64.fromUint8Array(redactionKeyPair.publicKey),
          keys: [
            { user_id: userId, wrapped_secret_key: Base64.fromUint8Array(wrapped) },
          ],
        })
        .pipe(
          map(() => redactionKeyPair),
          // Lost the create race (409): another sender installed the key first,
          // so fetch and use theirs.
          catchError((err) =>
            (err as { status?: number })?.status === 409
              ? this.fetchKeyPair(conversation.record.id)
              : throwError(() => err),
          ),
        );
    });
  }

  private cacheKeyPair(conversationId: string, keyPair: KeyPair): void {
    const state = this._state.get(conversationId);
    if (state) {
      state.keyPair = keyPair;
      this._state.set(conversationId, state);
    } else {
      this.setState(conversationId, { keyPair, keyVersion: 1, entries: new Map() });
    }
  }

  private setState(conversationId: string, state: ConversationRedaction): void {
    this._state.set(conversationId, state);
    this.revision.update((v) => v + 1);
  }

  private unwrapKeyPair(publicKeyB64: string, wrappedSecretB64: string): KeyPair {
    const userKeyPair = this._vault.keyPair();
    if (!userKeyPair) {
      throw NoUserKeyPairError;
    }
    const secretKey = this._crypto.openSealedBox(
      Base64.toUint8Array(wrappedSecretB64),
      userKeyPair,
    );
    return { publicKey: Base64.toUint8Array(publicKeyB64), secretKey };
  }

  private sealEntry(entry: RedactionEntry, keyPair: KeyPair): string {
    // Coerce into the current realm's Uint8Array — tweetnacl rejects typed
    // arrays from another realm (e.g. TextEncoder output under jsdom).
    const payload = new Uint8Array(new TextEncoder().encode(JSON.stringify(entry)));
    return Base64.fromUint8Array(
      this._crypto.createSealedBox(payload, keyPair.publicKey),
    );
  }

  // tryDecryptEntry isolates a single entry's failure so one bad blob never
  // takes down hydration for the rest (spec §17 reliability).
  private tryDecryptEntry(dataB64: string, keyPair: KeyPair): RedactionEntry | null {
    try {
      const plaintext = this._crypto.openSealedBox(
        Base64.toUint8Array(dataB64),
        keyPair,
      );
      return JSON.parse(new TextDecoder().decode(plaintext)) as RedactionEntry;
    } catch {
      return null;
    }
  }
}
