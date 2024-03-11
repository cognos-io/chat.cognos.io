import { Injectable, inject } from '@angular/core';
import { Observable, Subject, from, map, of, switchMap } from 'rxjs';
import { TypedPocketBase } from '../types/pocketbase-types';
import PocketBase from 'pocketbase';
import { signalSlice } from 'ngxtension/signal-slice';
import { CryptoService } from './crypto.service';
import {
  ConversationData,
  ConversationRecord,
  parseConversationData,
  serializeConversationData,
} from '../interfaces/conversation';
import { AuthService } from './auth.service';
import { KeyPair } from '../interfaces/key-pair';
import { Base64 } from 'js-base64';
import { VaultService } from './vault.service';

interface ConversationState {
  conversationRecords: Array<ConversationRecord>;
  selectedConversationId: string;
}

const initialState: ConversationState = {
  conversationRecords: [],
  selectedConversationId: '',
};

@Injectable({
  providedIn: 'root',
})
export class ConversationService {
  private readonly cryptoService = inject(CryptoService);
  private readonly vaultService = inject(VaultService);

  private readonly pbConversationCollection = 'conversations';
  private readonly pbConversationPublicKeysCollection =
    'conversation_public_keys';
  private readonly pbConversationSecretKeyCollection =
    'conversation_secret_keys';

  private readonly pb: TypedPocketBase = inject(PocketBase);
  private readonly auth = inject(AuthService);

  // sources
  readonly newConversation$ = new Subject<string>(); // plaintext conversation title
  private readonly $newConversation = this.newConversation$.pipe(
    // When a new conversation is requested, generate a new key pair
    switchMap((conversationTitle) => of(this.cryptoService.newKeyPair()))
  );

  // state
  private state = signalSlice({
    initialState,
    sources: [],
    selectors: (state) => ({
      conversation: () =>
        state
          .conversationRecords()
          .find(
            (conversation) => conversation.id === state.selectedConversationId()
          ),
    }),
  });

  // selectors
  readonly conversation = this.state.conversation;

  /**
   * Creates a conversation in the PocketBase backend.
   *
   * @param conversation (Conversation)
   * @returns
   */
  //   private createConversation(plaintextTitle: string) {
  //     // Generate a new key pair for the conversation
  //     const conversationKeyPair = this.cryptoService.newKeyPair();

  //     // Encrypt the title with the conversation public key
  //     const encryptedTitleBytes = this.cryptoService.sealedBox(
  //       plaintextTitle,
  //       conversationKeyPair.publicKey
  //     );

  //     // Encrypt the conversation secret key with the user's public key

  //     // Create the conversation in the backend

  //     // Save the conversation public key in the backend

  //     // Save the conversation secret key in the backend

  //     return from(
  //       this.pb.collection(this.pbConversationCollection).create({
  //         data: conversation.data,
  //         creator: conversation.creatorId,
  //       })
  //     );
  //   }

  /**
   * encryptConversationData -
   *
   * @param data
   * @returns
   */
  encryptConversationData(
    data: ConversationData,
    conversationKeyPair: KeyPair
  ): Uint8Array {
    const plaintextData = serializeConversationData(data);
    const sharedSecret = this.sharedKey(conversationKeyPair);

    return this.cryptoService.box(plaintextData, sharedSecret);
  }

  /**
   * decryptConversationData - given a conversation record, decrypts the data and
   * returns a ConversationData object.
   *
   * @param data
   * @returns
   */
  decryptConversationData(
    record: ConversationRecord,
    conversationKeyPair: KeyPair
  ): ConversationData {
    const sharedSecret = this.sharedKey(conversationKeyPair);
    const decryptedDataBase64 = this.cryptoService.openBox(
      new TextEncoder().encode(record.data),
      sharedSecret
    );
    return parseConversationData(decryptedDataBase64);
  }

  /**
   * sharedKey - Generates a shared key for the given conversation.
   *
   * @param conversationKeyPair (KeyPair) - the conversation's key pair
   * @returns
   */
  sharedKey(conversationKeyPair: KeyPair): Uint8Array {
    return this.cryptoService.sharedKey(
      conversationKeyPair.publicKey,
      conversationKeyPair.secretKey
    );
  }

  fetchConversationPublicKey(conversationId: string): Observable<Uint8Array> {
    const filter = this.pb.filter('conversation={:conversationId}', {
      conversationId,
    });

    return from(
      this.pb
        .collection(this.pbConversationPublicKeysCollection)
        .getFirstListItem(filter)
    ).pipe(map((record) => Base64.toUint8Array(record.public_key)));
  }

  fetchConversationSecretKey(conversationId: string): Observable<Uint8Array> {
    const filter = this.pb.filter(
      'conversation={:conversationId} && user={:userId}',
      {
        conversationId,
        userId: this.auth.user()?.['id'],
      }
    );

    return from(
      this.pb
        .collection(this.pbConversationSecretKeyCollection)
        .getFirstListItem(filter)
    ).pipe(
      // Decode the encrypted base64 secret key
      map((record) => Base64.toUint8Array(record.secret_key))
    );
  }

  fetchConversationKeyPair(conversationId: string): Observable<KeyPair> {
    return this.fetchConversationPublicKey(conversationId).pipe(
      switchMap((publicKey) =>
        this.fetchConversationSecretKey(conversationId).pipe(
          map((secretKey) => {
            const sharedKey = this.cryptoService.sharedKey(
              publicKey,
              this.vaultService.secretKey()
            );
            const decryptedSecretKey = this.cryptoService.openBox(
              secretKey,
              sharedKey
            );
            return {
              publicKey,
              secretKey: decryptedSecretKey,
            };
          })
        )
      )
    );
  }

  saveConversationKeyPair(
    conversationId: string,
    conversationKeyPair: KeyPair
  ): Observable<KeyPair> {
    return from(
      this.pb.collection(this.pbConversationPublicKeysCollection).create({
        conversation: conversationId,
        public_key: Base64.fromUint8Array(conversationKeyPair.publicKey),
      })
    ).pipe(
      switchMap(() => {
        const sharedKey = this.cryptoService.sharedKey(
          conversationKeyPair.publicKey,
          this.vaultService.secretKey()
        );
        const encryptedSecretKey = this.cryptoService.box(
          conversationKeyPair.secretKey,
          sharedKey
        );
        return from(
          this.pb.collection(this.pbConversationSecretKeyCollection).create({
            conversation: conversationId,
            secret_key: Base64.fromUint8Array(encryptedSecretKey),
            user: this.auth.user()?.['id'],
          })
        ).pipe(
          switchMap(() => {
            return of(conversationKeyPair);
          })
        );
      })
    );
  }
}
