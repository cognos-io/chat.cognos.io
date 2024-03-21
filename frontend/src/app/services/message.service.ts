import { Injectable, computed, inject } from '@angular/core';

import PocketBase, { ListResult } from 'pocketbase';

import { Observable, Subject, from, map, switchMap } from 'rxjs';

import { Base64 } from 'js-base64';
import { signalSlice } from 'ngxtension/signal-slice';

import { Message, parseMessageData } from '@app/interfaces/message';
import {
  MessagesRecord,
  MessagesResponse,
  TypedPocketBase,
} from '@app/types/pocketbase-types';

import { ConversationService } from './conversation.service';
import { CryptoService } from './crypto.service';

interface MessageState {
  conversations: {
    [conversationId: string]: Message[];
  };
}

const initialState: MessageState = {
  conversations: {},
};

@Injectable({
  providedIn: 'root',
})
export class MessageService {
  private readonly pb: TypedPocketBase = inject(PocketBase);
  private readonly cryptoService = inject(CryptoService);
  private readonly conversationService = inject(ConversationService);

  private readonly pbMessagesCollection = this.pb.collection('messages');

  // sources
  public readonly sendMessage$ = new Subject<{
    message?: string;
  }>();

  // state
  private readonly state = signalSlice({
    initialState,
    sources: [
      // when the conversation changes, load the messages
      (state) =>
        this.conversationService.selectConversation$.pipe(
          switchMap((conversationId) =>
            this.loadMessages(conversationId).pipe(
              map((messages) => {
                return {
                  conversations: {
                    ...state().conversations,
                    [conversationId]: messages,
                  },
                };
              }),
            ),
          ),
        ),
    ],
  });

  // selectors
  public readonly messages = computed(() => {
    const conversationId = this.conversationService.conversation()?.record.id;
    if (!conversationId) {
      return [];
    }
    const messages = this.state().conversations[conversationId];
    return messages || [];
  });

  // helper methods
  private fetchMessages(
    conversationId: string,
  ): Observable<ListResult<MessagesResponse>> {
    return from(
      this.pbMessagesCollection.getList(
        1, // page
        100, // pageSize
        {
          conversation: conversationId,
        },
      ),
    );
  }

  private decryptMessage(record: MessagesRecord): Message {
    const base64EncryptedData = record.data;
    const conversation = this.conversationService.conversation();

    if (!conversation) {
      throw new Error('No conversation selected');
    }

    try {
      const decryptedData = this.cryptoService.openSealedBox(
        Base64.toUint8Array(base64EncryptedData),
        conversation.keyPair,
      );

      return {
        record,
        decryptedData: parseMessageData(decryptedData),
      };
    } catch (error) {
      // Show to the user the message failed to decrypt
      console.error('Message decryption failed', error);
      return {
        record,
        decryptedData: {
          content: 'Failed to decrypt message',
        },
      };
    }
  }

  private loadMessages(conversationId: string): Observable<Message[]> {
    return this.fetchMessages(conversationId).pipe(
      map((response) => {
        return response.items.map((record) => this.decryptMessage(record));
      }),
    );
  }

  private sendMessage(
    message: string,
    conversationId: string,
  ): Observable<MessagesRecord> {
    console.log(message, conversationId);
    return from(this.pbMessagesCollection.create());
  }
}
