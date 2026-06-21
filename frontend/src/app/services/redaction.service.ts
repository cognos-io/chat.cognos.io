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
  defaultTokenGenerator,
  detectSensitiveText,
  hydrateRedactedText,
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

  // Whether redaction is active for new messages. On by default (secure by
  // default); the user can turn it off in settings for all future messages.
  readonly enabled = this._userPreferences.redactionEnabled;

  // Bumped whenever decrypted entries change, so templates can recompute
  // hydrated content reactively without threading the Map through signals.
  readonly revision = signal(0);

  // Load and decrypt a conversation's mappings as soon as it becomes active, so
  // hydration is ready by the time messages render.
  private readonly _autoLoad = effect(() => {
    const conversation = this._conversationService.conversation();
    const id = conversation?.record.id ?? null;
    if (!conversation || id === this._loadedConversationId) {
      return;
    }
    this._loadedConversationId = id;
    this.loadConversation(conversation).subscribe({
      error: () => {
        // A failed load leaves placeholders visible rather than breaking the
        // conversation view (spec §17 reliability).
      },
    });
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

  /** Restore originals for known tokens. Display-only; never mutates stored data. */
  hydrate(conversationId: string | null | undefined, text: string): string {
    if (!conversationId) {
      return text;
    }
    const state = this._state.get(conversationId);
    if (!state || state.entries.size === 0) {
      return text;
    }
    return hydrateRedactedText(text, Array.from(state.entries.values()));
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
