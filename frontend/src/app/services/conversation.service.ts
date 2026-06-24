import { Injectable, computed, inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';

import {
  EMPTY,
  Observable,
  Subject,
  catchError,
  concatMap,
  forkJoin,
  from,
  map,
  of,
  switchMap,
  take,
  tap,
  throwError,
} from 'rxjs';

import { Base64 } from 'js-base64';
import { signalSlice } from 'ngxtension/signal-slice';

import { ignorePocketbase404 } from '@app/operators/ignore-404';

import {
  Conversation,
  ConversationData,
  ConversationRecord,
  parseConversationData,
  partitionConversationsByPinned,
  serializeConversationData,
  sortConversationsByUpdated,
} from '../interfaces/conversation';
import { KeyPair } from '../interfaces/key-pair';
import { ConversationsExpiryDurationOptions } from '../types/pocketbase-types';
import { AuthService } from './auth.service';
import { CognosApiService } from './cognos-api.service';
import { CryptoService } from './crypto.service';
import { UserPreferencesService } from './user-preferences.service';
import { VaultService } from './vault.service';

export const UserSecretKeyNotFoundError = new Error('User secret key not found');

interface ConversationState {
  conversations: Array<Conversation>;
  selectedConversationId: string;
  filter: string;
  isTemporaryConversation: boolean;
  expirationDuration: string;
}

const initialState: ConversationState = {
  conversations: [],
  selectedConversationId: '',
  filter: '',
  isTemporaryConversation: false,
  expirationDuration: '',
};

const conversationPublicKeyMACKeyContext = 'cognos:conv-key-mac:v1';

@Injectable({
  providedIn: 'root',
})
export class ConversationService {
  private readonly _cryptoService = inject(CryptoService);
  private readonly _vaultService = inject(VaultService);
  private readonly _auth = inject(AuthService);
  private readonly _api = inject(CognosApiService);
  private readonly _router = inject(Router);
  private readonly _userPreferencesService = inject(UserPreferencesService);

  // sources
  readonly selectConversation$ = new Subject<string>(); // conversationId
  readonly newConversation$ = new Subject<ConversationData>();
  private readonly _newConversation$ = this.newConversation$.pipe(
    map((data) => ({ ...data, title: data.title.trim() })),
  );
  readonly filter$ = new Subject<string>();
  readonly deleteConversation$ = new Subject<string>(); // conversationId

  // state
  private state = signalSlice({
    initialState,
    sources: [
      // Clear conversation state when the user logs out
      this._auth.logout$.pipe(
        map(() => {
          return initialState;
        }),
      ),
      // When newConversation emits, create a new conversation
      (state) =>
        this._newConversation$.pipe(
          switchMap((data) =>
            this.createConversation(data).pipe(
              catchError((error) => {
                console.error(error);
                return EMPTY;
              }),
              tap((conversation) => {
                this._router.navigate(['/', 'c', conversation.record.id]);
              }),
              map((conversation) => {
                return {
                  selectedConversationId: conversation.record.id,
                  conversations: [conversation, ...state().conversations],
                  expirationDuration: '', // reset this after creating a conversation
                };
              }),
            ),
          ),
        ),
      // When selectConversation emits, fetch the conversation details
      this.selectConversation$.pipe(
        map((conversationId) => {
          return {
            selectedConversationId: conversationId,
            isTemporaryConversation: false,
          };
        }),
      ),
      // When filter emits, apply the filter
      this.filter$.pipe(
        map((filter) => {
          return { filter };
        }),
      ),
      // When the user's key pair changes, reload or clear the conversations.
      // `fetchConversations` only returns standalone conversations (the list
      // endpoint excludes project ones), so we MERGE rather than replace:
      // project conversations are loaded separately by
      // ProjectConversationService and upserted into this same store. Replacing
      // would drop them whenever this reload lands after that upsert (a load
      // race), leaving project chats missing from the sidebar and unopenable.
      (state) =>
        this._vaultService.keyPair$.pipe(
          switchMap((keyPair) => {
            if (!keyPair) {
              return of(initialState);
            }

            return this.fetchConversations().pipe(
              map((fetched) => {
                const byId = new Map<string, Conversation>();
                // Retain already-loaded project conversations…
                for (const conversation of state().conversations) {
                  if (conversation.record.project) {
                    byId.set(conversation.record.id, conversation);
                  }
                }
                // …then overlay the freshly-fetched standalone conversations.
                for (const conversation of fetched) {
                  byId.set(conversation.record.id, conversation);
                }
                return { conversations: [...byId.values()] };
              }),
            );
          }),
        ),
      // When deleteConversation emits, delete the conversation
      (state) =>
        this.deleteConversation$.pipe(
          switchMap((conversationId) =>
            this.deleteConversation(conversationId).pipe(
              catchError((error) => {
                console.error(error);
                return EMPTY;
              }),
              map(() => {
                let selectedConversationId = state().selectedConversationId;
                if (conversationId === selectedConversationId) {
                  selectedConversationId = '';
                }

                return {
                  conversations: state().conversations.filter(
                    (conversation) => conversation.record.id !== conversationId,
                  ),
                  selectedConversationId,
                };
              }),
            ),
          ),
        ),
    ],
    selectors: (state) => {
      const filteredConversations = computed(() => {
        // Standalone conversations make up the Pinned/Recent lists. Project
        // conversations are surfaced under their project's collapsible group in
        // the sidebar instead, so they're excluded here to avoid showing twice.
        // (They remain in state.conversations() so opening one still resolves.)
        const all = state
          .conversations()
          .filter((conversation) => !conversation.record.project);

        const filter = state.filter().trim().toLowerCase();
        if (filter === '') return all;

        return all.filter((conversation) =>
          conversation.decryptedData.title.toLowerCase().includes(filter),
        );
      });

      const orderedConversations = computed(() => {
        return sortConversationsByUpdated(filteredConversations());
      });

      const pinnedConversationIds = this._userPreferencesService.pinnedConversationIds;

      return {
        filteredConversations,
        orderedConversations,
        selectedConversation: () => {
          const selectedConversationId = state.selectedConversationId();
          return state
            .conversations()
            .find((conversation) => conversation.record.id === selectedConversationId);
        },
        pinnedConversations: computed(() => {
          return partitionConversationsByPinned(
            orderedConversations(),
            pinnedConversationIds(),
          ).pinned;
        }),
        nonPinnedConversations: computed(() => {
          return partitionConversationsByPinned(
            orderedConversations(),
            pinnedConversationIds(),
          ).recent;
        }),
      };
    },
    actionSources: {
      setExpirationDuration: (
        state,
        $: Observable<{
          id: string;
          expirationDuration?: ConversationsExpiryDurationOptions;
        }>,
      ) =>
        $.pipe(
          map(({ id, expirationDuration }) => {
            const conversations = state().conversations;
            const index = conversations.findIndex((c) => c.record.id === id);
            if (index === -1)
              // If the conversation is not found, add it to the top level state
              return {
                expirationDuration,
              };

            conversations[index].record.expiry_duration = expirationDuration;

            return {
              conversations,
            };
          }),
        ),
      setIsTemporaryConversation: (state, $: Observable<boolean>) => {
        return $.pipe(
          map((isTemporaryConversation) => {
            return {
              isTemporaryConversation,
            };
          }),
        );
      },
      updateConversationRecord: (state, $: Observable<ConversationRecord>) => {
        return $.pipe(
          concatMap((data) => {
            return this.fetchConversation(data).pipe(
              take(1),
              map((conversation) => {
                const conversations = state().conversations;
                const index = conversations.findIndex(
                  (c) => c.record.id === conversation.record.id,
                );
                if (index === -1) return state();
                conversations[index] = conversation;
                return {
                  conversations: [...conversations],
                };
              }),
            );
          }),
        );
      },
      setConversationTitle: (state, $: Observable<{ id: string; title: string }>) => {
        return $.pipe(
          map(({ id, title }) => {
            const conversations = state().conversations;
            const index = conversations.findIndex((c) => c.record.id === id);
            if (index === -1) return state();
            conversations[index].decryptedData.title = title;
            return {
              conversations,
            };
          }),
        );
      },
      updateConversationUpdatedTimeNow: (state, $: Observable<{ id: string }>) =>
        $.pipe(
          map(({ id }) => {
            const conversations = state().conversations;
            const index = conversations.findIndex((c) => c.record.id === id);
            if (index === -1) return state();
            const now = new Date().toISOString();
            conversations[index].record.updated = now;
            conversations[index].record.last_activity_at = now;
            return {
              conversations: [...conversations],
            };
          }),
        ),
      // Empties the in-memory list after the server-side bulk delete so the
      // sidebar reflects the wipe without a refetch.
      clearConversations: (_state, $: Observable<void>) =>
        $.pipe(map(() => ({ conversations: [], selectedConversationId: '' }))),
      // Merges externally-loaded conversations (notably project conversations,
      // which the main list endpoint excludes) into the store by id, so the
      // chat view can select and message them like any other conversation.
      upsertConversations: (state, $: Observable<Conversation[]>) =>
        $.pipe(
          map((incoming) => {
            const byId = new Map(
              state().conversations.map((conversation) => [
                conversation.record.id,
                conversation,
              ]),
            );
            for (const conversation of incoming) {
              byId.set(conversation.record.id, conversation);
            }
            return { conversations: [...byId.values()] };
          }),
        ),
    },
  });

  // selectors
  readonly conversation = this.state.selectedConversation;
  readonly conversation$ = toObservable(this.conversation);
  readonly conversationList = this.state.orderedConversations;

  readonly pinnedConversations = this.state.pinnedConversations;
  readonly hasPinnedConversations = computed(
    () => this.pinnedConversations().length > 0,
  );

  // The expiration duration for this conversation
  readonly expirationDuration = this.state.expirationDuration;
  readonly setExpirationDuration = this.state.setExpirationDuration;

  readonly nonPinnedConversations = this.state.nonPinnedConversations;
  readonly hasNonPinnedConversations = computed(
    () => this.nonPinnedConversations().length > 0,
  );

  readonly getConversation = (conversationId: string) =>
    computed(() => {
      return this.state
        .conversations()
        .find((conversation) => conversation.record.id === conversationId);
    });

  readonly setConversationTitle = this.state.setConversationTitle;
  readonly isTemporaryConversation = this.state.isTemporaryConversation;
  readonly setIsTemporaryConversation = this.state.setIsTemporaryConversation;
  // Merge project conversations (loaded by ProjectConversationService) into the
  // store so the chat view can select and message them.
  readonly upsertConversations = this.state.upsertConversations;

  readonly updateConversationUpdatedTimeNow =
    this.state.updateConversationUpdatedTimeNow;

  /**
   * Creates a conversation in the PocketBase backend.
   *
   * @param conversation (ConversationData)
   * @returns (Observable<string>) - the id of the new conversation
   */
  private createConversation(data: ConversationData): Observable<Conversation> {
    // We have to have a user secret key to create a conversation
    const userSecretKey = this._vaultService.keyPair()?.secretKey;
    if (!userSecretKey) {
      return throwError(() => UserSecretKeyNotFoundError);
    }

    // Generate a new key pair for the conversation
    const conversationKeyPair = this._cryptoService.newKeyPair();

    // Use the conversation key pair to encrypt the conversation data
    const encryptedData = this.encryptConversationData(data, conversationKeyPair);

    // Create the conversation in the backend with the encrypted data
    return this._api
      .createConversation({
        data: Base64.fromUint8Array(encryptedData),
        expiry_duration: this.expirationDuration(),
      })
      .pipe(
        switchMap((record) => {
          // Save the conversation key pair in the backend
          return this.saveConversationKeyPair(record.id, conversationKeyPair).pipe(
            // Return the newly created conversation
            map(() => {
              return {
                record,
                decryptedData: data,
                keyPair: conversationKeyPair,
                expirationDuration: '',
              };
            }),
          );
        }),
      );
  }

  /**
   * encryptConversationData - given a ConversationData object and a conversation key
   * pair, encrypts the data and returns the encrypted binary data.
   *
   * @param data (ConversationData)
   * @param conversationKeyPair (KeyPair)
   * @returns (Uint8Array)
   */
  private encryptConversationData(
    data: ConversationData,
    conversationKeyPair: KeyPair,
  ): Uint8Array {
    const plaintextData = serializeConversationData(data);
    const sharedSecret = this.sharedKey(conversationKeyPair);

    return this._cryptoService.box(plaintextData, sharedSecret);
  }

  /**
   * decryptConversationData - given a conversation record, decrypts the data and
   * returns a ConversationData object.
   *
   * @param record (ConversationRecord)
   * @param conversationKeyPair (KeyPair)
   * @returns (ConversationData)
   */
  private decryptConversationData(
    record: ConversationRecord,
    conversationKeyPair: KeyPair,
  ): ConversationData {
    const sharedSecret = this.sharedKey(conversationKeyPair);
    const decryptedData = this._cryptoService.openBox(
      Base64.toUint8Array(record.data),
      sharedSecret,
    );
    return parseConversationData(decryptedData);
  }

  /**
   * sharedKey - Generates a shared key for the given conversation.
   *
   * @param conversationKeyPair (KeyPair) - the conversation's key pair
   * @returns (Uint8Array) - the shared key
   */
  private sharedKey(conversationKeyPair: KeyPair): Uint8Array {
    return this._cryptoService.sharedKey(
      conversationKeyPair.publicKey,
      conversationKeyPair.secretKey,
    );
  }

  /**
   * fetchConversationPublicKey - fetches the public key for a conversation from
   * the PocketBase backend.
   *
   * @param conversationId (string)
   * @returns (Observable<Uint8Array>)
   */
  private fetchConversationPublicKeyRecord(
    conversationId: string,
  ): Observable<{ id: string; public_key: string; public_key_signature?: string }> {
    return this._api
      .getConversationPublicKey(conversationId)
      .pipe(ignorePocketbase404());
  }

  /**
   * fetchConversationSecretKey - fetches the secret key for a conversation from
   * the PocketBase backend.
   *
   * @param conversationId (string)
   * @returns (Observable<Uint8Array>)
   */
  private fetchConversationSecretKey(conversationId: string): Observable<Uint8Array> {
    return this._api.getConversationSecretKey(conversationId).pipe(
      ignorePocketbase404(),
      map((record) => Base64.toUint8Array(record.secret_key)),
    );
  }

  /**
   * fetchConversationKeyPair - fetches the key pair for a conversation from the
   * PocketBase backend.
   *
   * @param conversationId (string)
   * @returns (Observable<KeyPair>)
   */
  private fetchConversationKeyPair(conversationId: string): Observable<KeyPair> {
    const userSecretKey = this._vaultService.keyPair()?.secretKey;
    if (!userSecretKey) {
      throw UserSecretKeyNotFoundError;
    }

    return this.fetchConversationPublicKeyRecord(conversationId).pipe(
      switchMap((record) => {
        if (!record.public_key_signature) {
          throw new Error('Conversation public key signature missing');
        }

        const publicKey = Base64.toUint8Array(record.public_key);
        const publicKeySignature = this.computeConversationPublicKeySignature(
          conversationId,
          publicKey,
          userSecretKey,
        );
        const expectedSignature = Base64.toUint8Array(record.public_key_signature);
        if (!this._cryptoService.equalBytes(publicKeySignature, expectedSignature)) {
          throw new Error('Conversation public key signature mismatch');
        }

        return this.fetchConversationSecretKey(conversationId).pipe(
          map((secretKey) => {
            const sharedKey = this._cryptoService.sharedKey(publicKey, userSecretKey);
            const decryptedSecretKey = this._cryptoService.openBox(
              secretKey,
              sharedKey,
            );
            return {
              publicKey,
              secretKey: decryptedSecretKey,
            };
          }),
        );
      }),
    );
  }

  /**
   * saveConversationKeyPair - saves the key pair for a conversation in the
   * PocketBase backend.
   *
   * @param conversationId (string)
   * @param conversationKeyPair (KeyPair)
   * @returns (Observable<KeyPair>)
   */
  private saveConversationKeyPair(
    conversationId: string,
    conversationKeyPair: KeyPair,
  ): Observable<KeyPair> {
    const userSecretKey = this._vaultService.keyPair()?.secretKey;
    if (!userSecretKey) {
      throw UserSecretKeyNotFoundError;
    }

    return this._api
      .createConversationPublicKey(conversationId, {
        public_key: Base64.fromUint8Array(conversationKeyPair.publicKey),
        public_key_signature: Base64.fromUint8Array(
          this.computeConversationPublicKeySignature(
            conversationId,
            conversationKeyPair.publicKey,
            userSecretKey,
          ),
        ),
      })
      .pipe(
        switchMap(() => {
          const sharedKey = this._cryptoService.sharedKey(
            conversationKeyPair.publicKey,
            userSecretKey,
          );
          const encryptedSecretKey = this._cryptoService.box(
            conversationKeyPair.secretKey,
            sharedKey,
          );
          return this._api
            .createConversationSecretKey(conversationId, {
              secret_key: Base64.fromUint8Array(encryptedSecretKey),
            })
            .pipe(
              switchMap(() => {
                return of(conversationKeyPair);
              }),
            );
        }),
      );
  }

  /**
   * fetchConversations - fetches a specific conversation from the PocketBase backend.
   *
   * @returns (Observable<Conversation>)
   */
  private fetchConversation(record: ConversationRecord): Observable<Conversation> {
    return this.fetchConversationKeyPair(record.id).pipe(
      map((keyPair) => {
        return {
          record,
          decryptedData: this.decryptConversationData(record, keyPair),
          keyPair,
        };
      }),
      catchError((error) => {
        console.error('Conversation decryption failed', error);
        return EMPTY;
      }),
    );
  }

  /**
   * fetchConversations - fetches all conversations from the PocketBase backend and
   * the key pair for each.
   *
   * @returns (Observable<Array<Conversation>>)
   */
  private fetchConversations(): Observable<Array<Conversation>> {
    return from(this.fetchConversationRecords()).pipe(
      switchMap((records) =>
        forkJoin(records.map((record) => this.fetchConversation(record))),
      ),
    );
  }

  private computeConversationPublicKeySignature(
    conversationId: string,
    publicKey: Uint8Array,
    userSecretKey: Uint8Array,
  ): Uint8Array {
    const payload = new TextEncoder().encode(
      JSON.stringify([
        'conversation_public_key_v1',
        conversationId,
        Base64.fromUint8Array(publicKey),
      ]),
    );
    const macKey = this._cryptoService.mac(
      new TextEncoder().encode(conversationPublicKeyMACKeyContext),
      userSecretKey,
    );

    return this._cryptoService.mac(payload, macKey);
  }

  /**
   * loadConversationKeyPair - public access to a conversation's decrypted key
   * pair (verifying the stored public-key signature). The duplicate flow uses
   * it to decrypt a source conversation that may not be the active one.
   *
   * @param conversationId (string)
   * @returns (Observable<KeyPair>)
   */
  loadConversationKeyPair(conversationId: string): Observable<KeyPair> {
    return this.fetchConversationKeyPair(conversationId);
  }

  /**
   * buildNewConversationKeyMaterial - produces the conversation-level key
   * material for a brand-new conversation whose id the caller has generated,
   * reusing the exact wire format the loader later verifies. The duplicate
   * flow uses this to bundle everything into a single /copies request instead
   * of the usual separate public-key/secret-key POSTs. The conversation data
   * is encrypted to the supplied keypair; the secret key is wrapped for the
   * current user. Owning the format here keeps it from drifting out of step
   * with fetchConversationKeyPair.
   */
  buildNewConversationKeyMaterial(
    conversationId: string,
    data: ConversationData,
    conversationKeyPair: KeyPair,
  ): {
    data: string;
    public_key: string;
    public_key_signature: string;
    wrapped_secret_key: string;
  } {
    const userSecretKey = this._vaultService.keyPair()?.secretKey;
    if (!userSecretKey) {
      throw UserSecretKeyNotFoundError;
    }

    const sharedKey = this._cryptoService.sharedKey(
      conversationKeyPair.publicKey,
      userSecretKey,
    );

    return {
      data: Base64.fromUint8Array(
        this.encryptConversationData(data, conversationKeyPair),
      ),
      public_key: Base64.fromUint8Array(conversationKeyPair.publicKey),
      public_key_signature: Base64.fromUint8Array(
        this.computeConversationPublicKeySignature(
          conversationId,
          conversationKeyPair.publicKey,
          userSecretKey,
        ),
      ),
      wrapped_secret_key: Base64.fromUint8Array(
        this._cryptoService.box(conversationKeyPair.secretKey, sharedKey),
      ),
    };
  }

  /**
   * fetchConversationRecords - fetches all conversation records from the backend.
   *
   * @returns (Observable<Array<ConversationRecord>>)
   */
  private fetchConversationRecords(): Observable<Array<ConversationRecord>> {
    return this._api.listConversations();
  }

  private deleteConversation(conversationId: string): Observable<void> {
    return this._api.deleteConversation(conversationId);
  }

  // Deletes every conversation the user has (the account "delete all chats"
  // danger action), then clears the in-memory list. The caller subscribes for
  // the completion / error so it can confirm to the user.
  deleteAllConversations(): Observable<{ deleted: number }> {
    return this._api
      .deleteAllConversations()
      .pipe(tap(() => this.state.clearConversations()));
  }

  editConversation(
    id: string,
    expiryDuration: string,
    data: ConversationData,
  ): Observable<ConversationRecord> {
    // Validate the expiry duration
    if (
      expiryDuration !== '' &&
      !(expiryDuration in ConversationsExpiryDurationOptions)
    ) {
      return throwError(() => new Error('Invalid expiry duration'));
    }

    // Get the keypair for the conversation
    const conversationKeyPair = this.getConversation(id)()?.keyPair;
    if (!conversationKeyPair) {
      return throwError(() => new Error('Conversation key pair not found'));
    }

    // Encrypt the new data with the conversation's key pair
    const encryptedData = this.encryptConversationData(data, conversationKeyPair);

    return this._api
      .updateConversation(id, {
        data: Base64.fromUint8Array(encryptedData),
        expiry_duration: expiryDuration,
      })
      .pipe(
        tap((resp) => {
          this.state.updateConversationRecord(resp);
        }),
      );
  }
}
