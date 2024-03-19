import { Injectable, inject } from '@angular/core';

import PocketBase, { ListResult } from 'pocketbase';

import { Observable, Subject, from, switchMap } from 'rxjs';

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
  private readonly selectedConversation$ = new Subject<string>();
  // When the conversation changes, load the messages for the new conversation
  private readonly messagesForConversation$ = this.selectedConversation$.pipe(
    switchMap((conversationId) => this.fetchMessages(conversationId)),
  );

  // state
  private readonly state = signalSlice({
    initialState,
    sources: [],
  });

  // selectors

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

    const decryptedData = this.cryptoService.openSealedBox(
      Base64.toUint8Array(base64EncryptedData),
      conversation.keyPair,
    );

    return {
      record,
      decryptedData: parseMessageData(decryptedData),
    };
  }

  private sendMessage(
    message: string,
    conversationId: string,
  ): Observable<MessagesRecord> {
    console.log(message, conversationId);
    return from(this.pbMessagesCollection.create());
  }
}
