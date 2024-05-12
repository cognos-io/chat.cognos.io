import { Injectable, computed, inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';

import PocketBase from 'pocketbase';

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
import { VaultService } from './vault.service';

export const UserSecretKeyNotFoundError = new Error('User secret key not found');

interface ConversationState {
  conversations: Array<Conversation>;
  selectedConversationId: string;
  filter: string;
}

const initialState: ConversationState = {
  conversations: [],
  selectedConversationId: '',
  filter: '',
};

@Injectable({
  providedIn: 'root',
})
export class ConversationService {
  private readonly pb: TypedPocketBase = inject(PocketBase);
  private readonly cryptoService = inject(CryptoService);
  private readonly vaultService = inject(VaultService);
  private readonly auth = inject(AuthService);
  private readonly _router = inject(Router);

  private readonly pbConversationCollection = 'conversations';
  private readonly pbConversationPublicKeysCollection = 'conversation_public_keys';
  private readonly pbConversationSecretKeyCollection = 'conversation_secret_keys';

  // sources
  readonly selectConversation$ = new Subject<string>(); // conversationId
  readonly newConversation$ = new Subject<ConversationData>();
  readonly filter$ = new Subject<string>();
  readonly deleteConversation$ = new Subject<string>(); // conversationId

  // state
  private state = signalSlice({
    initialState,
    sources: [
      // When newConversation emits, create a new conversation
      (state) =>
        this.newConversation$.pipe(
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
      this.vaultService.keyPair$.pipe(
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

      return {
        filteredConversations,
        orderedConversations: () => {
          return filteredConversations().sort((a, b) => {
            // TODO(ewan): Include the most recent message
            // Sort the conversations by the most recently updated
            return b.record.updated.localeCompare(a.record.created);
          });
        },
        selectedConversation: () => {
          const selectedConversationId = state.selectedConversationId();
          return state
            .conversations()
            .find((conversation) => conversation.record.id === selectedConversationId);
        },
      };
    },
  });

  // selectors
  readonly conversation = this.state.selectedConversation;
  readonly conversation$ = toObservable(this.conversation);
  readonly conversationList = this.state.orderedConversations;

  /**
   * Creates a conversation in the PocketBase backend.
   *
   * @param conversation (ConversationData)
   * @returns (Observable<string>) - the id of the new conversation
   */
  private createConversation(data: ConversationData): Observable<Conversation> {
    // We have to have a user secret key to create a conversation
    const userSecretKey = this.vaultService.keyPair()?.secretKey;
    if (!userSecretKey) {
      return throwError(() => UserSecretKeyNotFoundError);
    }

    // Generate a new key pair for the conversation
    const conversationKeyPair = this.cryptoService.newKeyPair();

    // Use the conversation key pair to encrypt the conversation data
    const encryptedData = this.encryptConversationData(data, conversationKeyPair);

    // Create the conversation in the backend with the encrypted data
    return from(
      this.pb.collection(this.pbConversationCollection).create({
        data: Base64.fromUint8Array(encryptedData),
        creator: this.auth.user()?.['id'],
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

    return this.cryptoService.box(plaintextData, sharedSecret);
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
    const decryptedData = this.cryptoService.openBox(
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
    return this.cryptoService.sharedKey(
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
    const filter = this.pb.filter('conversation={:conversationId}', {
      conversationId,
    });

    return from(
      this.pb
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
    const filter = this.pb.filter('conversation={:conversationId} && user={:userId}', {
      conversationId,
      userId: this.auth.user()?.['id'],
    });

    return from(
      this.pb
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
            const userSecretKey = this.vaultService.keyPair()?.secretKey;
            if (!userSecretKey) {
              throw UserSecretKeyNotFoundError;
            }
            const sharedKey = this.cryptoService.sharedKey(publicKey, userSecretKey);
            const decryptedSecretKey = this.cryptoService.openBox(secretKey, sharedKey);
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
      this.pb.collection(this.pbConversationPublicKeysCollection).create({
        conversation: conversationId,
        public_key: Base64.fromUint8Array(conversationKeyPair.publicKey),
      }),
    ).pipe(
      switchMap(() => {
        const userSecretKey = this.vaultService.keyPair()?.secretKey;
        if (!userSecretKey) {
          throw UserSecretKeyNotFoundError;
        }
        const sharedKey = this.cryptoService.sharedKey(
          conversationKeyPair.publicKey,
          userSecretKey,
        );
        const encryptedSecretKey = this.cryptoService.box(
          conversationKeyPair.secretKey,
          sharedKey,
        );
        return from(
          this.pb.collection(this.pbConversationSecretKeyCollection).create({
            conversation: conversationId,
            secret_key: Base64.fromUint8Array(encryptedSecretKey),
            user: this.auth.user()?.['id'],
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
      this.pb.collection(this.pbConversationCollection).getOne(conversationId),
    );
  }

  /**
   * fetchConversationRecords - fetches all conversation records from the PocketBase backend.
   *
   * @returns (Observable<Array<ConversationRecord>>)
   */
  private fetchConversationRecords(): Observable<Array<ConversationRecord>> {
    return from(this.pb.collection(this.pbConversationCollection).getFullList());
  }

  private deleteConversation(conversationId: string): Observable<boolean> {
    return from(
      this.pb.collection(this.pbConversationCollection).delete(conversationId),
    );
  }
}
