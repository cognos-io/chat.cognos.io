import { Injectable, inject } from '@angular/core';
import { Subject, from, of, switchMap } from 'rxjs';
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
  private readonly pbConversationCollection = 'conversations';
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

  /**
   * sharedKeyWithUser - Generates a shared key for the given user and conversation.
   *
   * @param conversationKeyPair (KeyPair) - the conversation's key pair
   * @param userPublicKey (Uint8Array) - the user's public key
   * @returns
   */
  sharedKeyWithUser(conversationKeyPair: KeyPair, userPublicKey: Uint8Array) {
    return this.cryptoService.sharedKey(
      userPublicKey,
      conversationKeyPair.secretKey
    );
  }
}
