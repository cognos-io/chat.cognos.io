import { Injectable, inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';

import PocketBase, { ListResult } from 'pocketbase';

import { EMPTY, Observable, Subject, from, map, of, switchMap } from 'rxjs';

import { Base64 } from 'js-base64';
import { signalSlice } from 'ngxtension/signal-slice';
import OpenAI from 'openai';

import { Message, parseMessageData } from '@app/interfaces/message';
import {
  MessagesRecord,
  MessagesResponse,
  TypedPocketBase,
} from '@app/types/pocketbase-types';

import { ConversationService } from './conversation.service';
import { CryptoService } from './crypto.service';

interface MessageState {
  messages: Message[];
}

const initialState: MessageState = {
  messages: [],
};

@Injectable({
  providedIn: 'root',
})
export class MessageService {
  private readonly pb: TypedPocketBase = inject(PocketBase);
  private readonly cryptoService = inject(CryptoService);
  private readonly conversationService = inject(ConversationService);
  private readonly openAi = inject(OpenAI);

  private readonly pbMessagesCollection = this.pb.collection('messages');

  // sources
  public readonly sendMessage$ = new Subject<{
    message?: string;
  }>();

  // state
  private readonly state = signalSlice({
    initialState,
    sources: [
      // messages need a key pair, and a conversation
      this.conversationService.conversation$.pipe(
        switchMap((conversation) => {
          if (!conversation) {
            return of({
              messages: [],
            });
          }
          return this.loadMessages(conversation.record.id).pipe(
            map((messages) => {
              return {
                messages,
              };
            }),
          );
        }),
      ),
      // when a message is sent, add it to the list of messages
      (state) =>
        this.sendMessage$.pipe(
          switchMap(({ message }) => {
            if (message === undefined) {
              return EMPTY;
            }
            return this.sendMessage(message).pipe(
              map(() => {
                return {
                  messages: state().messages,
                };
              }),
            );
          }),
        ),
    ],
  });

  // selectors
  public readonly messages = this.state.messages;
  public readonly messages$ = toObservable(this.messages);

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

  private sendMessage(message: string): Observable<void> {
    const conversation = this.conversationService.conversation();
    if (!conversation) {
      throw new Error('No conversation selected');
    }

    return from(
      this.openAi.chat.completions.create({
        messages: [{ role: 'user', content: message }],
        model: 'gpt-3.5-turbo',
        metadata: {
          cognos: {
            agent_slug: 'simple-assistant',
            conversation_id: conversation.record.id,
          },
        },
      }),
    );
  }
}
