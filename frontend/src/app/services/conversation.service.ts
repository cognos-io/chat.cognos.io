import { Injectable, computed, inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';

import PocketBase from 'pocketbase';

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
  serializeConversationData,
} from '../interfaces/conversation';
import { KeyPair } from '../interfaces/key-pair';
import { TypedPocketBase } from '../types/pocketbase-types';
import { AuthService } from './auth.service';
import { CryptoService } from './crypto.service';
import { UserPreferencesService } from './user-preferences.service';
import { VaultService } from './vault.service';

export const UserSecretKeyNotFoundError = new Error('User secret key not found');

interface ConversationState {
  conversations: Array<Conversation>;
  selectedConversationId: string;
  filter: string;
  isTemporaryConversation: boolean;
}

const initialState: ConversationState = {
  conversations: [],
  selectedConversationId: '',
  filter: '',
  isTemporaryConversation: false,
};

@Injectable({
  providedIn: 'root',
})
export class ConversationService {
  private readonly _pb: TypedPocketBase = inject(PocketBase);
  private readonly _cryptoService = inject(CryptoService);
  private readonly _vaultService = inject(VaultService);
  private readonly _auth = inject(AuthService);
  private readonly _router = inject(Router);
  private readonly _userPreferencesService = inject(UserPreferencesService);

  private readonly pbConversationCollection = 'conversations';
  private readonly pbConversationPublicKeysCollection = 'conversation_public_keys';
  private readonly pbConversationSecretKeyCollection = 'conversation_secret_keys';

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
      // When the user's key pair changes, reload the conversations
      this._vaultService.keyPair$.pipe(
        switchMap((keyPair) => (keyPair ? this.fetchConversations() : [])),
        map((conversations) => {
          return { conversations };
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
        const filter = state.filter().trim().toLowerCase();
        if (filter === '') return state.conversations();

        return state
          .conversations()
          .filter((conversation) =>
            conversation.decryptedData.title.toLowerCase().includes(filter),
          );
      });

      const orderedConversations = computed(() => {
        return filteredConversations().sort((a, b) => {
          // TODO(ewan): Include the most recent message
          // Sort the conversations by the most recently updated
          return b.record.updated.localeCompare(a.record.created);
        });
      });

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
          return orderedConversations().filter((conversation) => {
            return this._userPreferencesService.isConversationPinned(
              conversation.record.id,
            );
          });
        }),
        nonPinnedConversations: computed(() => {
          return orderedConversations().filter((conversation) => {
            return !this._userPreferencesService.isConversationPinned(
              conversation.record.id,
            );
          });
        }),
      };
    },
    actionSources: {
      setIsTemporaryConversation: (state, action$: Observable<boolean>) => {
        return action$.pipe(
          map((isTemporaryConversation) => {
            return {
              isTemporaryConversation,
            };
          }),
        );
      },
      updateConversationRecord: (state, action$: Observable<ConversationRecord>) => {
        return action$.pipe(
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
      setConversationTitle: (
        state,
        action$: Observable<{ id: string; title: string }>,
      ) => {
        return action$.pipe(
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
    return from(
      this._pb.collection(this.pbConversationCollection).create({
        data: Base64.fromUint8Array(encryptedData),
        creator: this._auth.user()?.['id'],
      }),
    ).pipe(
      switchMap((record) => {
        // Save the conversation key pair in the backend
        return this.saveConversationKeyPair(record.id, conversationKeyPair).pipe(
          // Return the newly created conversation
          map(() => {
            return {
              record,
              decryptedData: data,
              keyPair: conversationKeyPair,
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
  private fetchConversationPublicKey(conversationId: string): Observable<Uint8Array> {
    const filter = this._pb.filter('conversation={:conversationId}', {
      conversationId,
    });

    return from(
      this._pb
        .collection(this.pbConversationPublicKeysCollection)
        .getFirstListItem(filter),
    ).pipe(
      ignorePocketbase404(),
      map((record) => Base64.toUint8Array(record.public_key)),
    );
  }

  /**
   * fetchConversationSecretKey - fetches the secret key for a conversation from
   * the PocketBase backend.
   *
   * @param conversationId (string)
   * @returns (Observable<Uint8Array>)
   */
  private fetchConversationSecretKey(conversationId: string): Observable<Uint8Array> {
    const filter = this._pb.filter('conversation={:conversationId} && user={:userId}', {
      conversationId,
      userId: this._auth.user()?.['id'],
    });

    return from(
      this._pb
        .collection(this.pbConversationSecretKeyCollection)
        .getFirstListItem(filter),
    ).pipe(
      ignorePocketbase404(),
      // Decode the encrypted base64 secret key
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
    return this.fetchConversationPublicKey(conversationId).pipe(
      switchMap((publicKey) =>
        this.fetchConversationSecretKey(conversationId).pipe(
          map((secretKey) => {
            const userSecretKey = this._vaultService.keyPair()?.secretKey;
            if (!userSecretKey) {
              throw UserSecretKeyNotFoundError;
            }
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
        ),
      ),
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
    return from(
      this._pb.collection(this.pbConversationPublicKeysCollection).create({
        conversation: conversationId,
        public_key: Base64.fromUint8Array(conversationKeyPair.publicKey),
      }),
    ).pipe(
      switchMap(() => {
        const userSecretKey = this._vaultService.keyPair()?.secretKey;
        if (!userSecretKey) {
          throw UserSecretKeyNotFoundError;
        }
        const sharedKey = this._cryptoService.sharedKey(
          conversationKeyPair.publicKey,
          userSecretKey,
        );
        const encryptedSecretKey = this._cryptoService.box(
          conversationKeyPair.secretKey,
          sharedKey,
        );
        return from(
          this._pb.collection(this.pbConversationSecretKeyCollection).create({
            conversation: conversationId,
            secret_key: Base64.fromUint8Array(encryptedSecretKey),
            user: this._auth.user()?.['id'],
          }),
        ).pipe(
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

  /**
   * fetchConversationRecord - fetches a specific conversation record from the PocketBase
   * backend.
   *
   * @returns (Observable<ConversationRecord>)
   */
  private fetchConversationRecord(
    conversationId: string,
  ): Observable<ConversationRecord> {
    return from(
      this._pb.collection(this.pbConversationCollection).getOne(conversationId),
    );
  }

  /**
   * fetchConversationRecords - fetches all conversation records from the PocketBase backend.
   *
   * @returns (Observable<Array<ConversationRecord>>)
   */
  private fetchConversationRecords(): Observable<Array<ConversationRecord>> {
    return from(this._pb.collection(this.pbConversationCollection).getFullList());
  }

  private deleteConversation(conversationId: string): Observable<boolean> {
    return from(
      this._pb.collection(this.pbConversationCollection).delete(conversationId),
    );
  }

  editConversation(id: string, data: ConversationData): Observable<ConversationRecord> {
    // Get the keypair for the conversation
    const conversationKeyPair = this.getConversation(id)()?.keyPair;
    if (!conversationKeyPair) {
      return throwError(() => new Error('Conversation key pair not found'));
    }

    // Encrypt the new data with the conversation's key pair
    const encryptedData = this.encryptConversationData(data, conversationKeyPair);

    return from(
      this._pb.collection(this.pbConversationCollection).update(id, {
        data: Base64.fromUint8Array(encryptedData),
      }),
    ).pipe(
      tap((resp) => {
        this.state.updateConversationRecord(resp);
      }),
    );
  }
}
