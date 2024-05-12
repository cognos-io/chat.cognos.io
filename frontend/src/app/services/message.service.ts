import { Injectable, inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';

import PocketBase, { ListResult } from 'pocketbase';

import {
  EMPTY,
  Observable,
  Subject,
  concatMap,
  filter,
  from,
  map,
  of,
  switchMap,
} from 'rxjs';

import { Base64 } from 'js-base64';
import { signalSlice } from 'ngxtension/signal-slice';
import OpenAI from 'openai';

import { Message, parseMessageData } from '@app/interfaces/message';
import { MessagesResponse, TypedPocketBase } from '@app/types/pocketbase-types';

import { AgentService } from './agent.service';
import { AuthService } from './auth.service';
import { ConversationService } from './conversation.service';
import { CryptoService } from './crypto.service';
import { ModelService } from './model.service';

export enum MessageStatus {
  None,
  Fetching,
  Decrypting,
}

interface MessageState {
  messages: Message[];
  status: MessageStatus;
}

const initialState: MessageState = {
  messages: [],
  status: MessageStatus.None,
};

interface RawMessage {
  conversationId?: string;
  message?: string;
}

@Injectable({
  providedIn: 'root',
})
export class MessageService {
  private readonly _pb: TypedPocketBase = inject(PocketBase);
  private readonly _modelService = inject(ModelService);
  private readonly _agentService = inject(AgentService);
  private readonly _cryptoService = inject(CryptoService);
  private readonly _conversationService = inject(ConversationService);
  private readonly _openAi = inject(OpenAI);
  private readonly _authService = inject(AuthService);

  private readonly pbMessagesCollection = this._pb.collection('messages');

  // sources
  public readonly sendMessage$ = new Subject<RawMessage>();
  private readonly _cleanedMessage$ = this.sendMessage$.pipe(
    map((raw) => ({ ...raw, message: raw.message?.trim() })),
    filter(({ message }) => message !== undefined && message !== ''),
  );

  // state
  private readonly state = signalSlice({
    initialState,
    sources: [
      // messages need a key pair, and a conversation
      // when the conversation changes, load the messages from the backend
      this._conversationService.conversation$.pipe(
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

      // when a message is sent, add it to the list of messages and send it to our upstream API
      (state) =>
        this._cleanedMessage$.pipe(
          map((raw) => {
            const message = raw.message;
            if (message === undefined || message === '') {
              return state();
            }
            const newMessage: Message = {
              createdAt: new Date(),
              decryptedData: {
                content: message,
                owner_id: this._authService.user()?.['id'],
              },
            };

            return {
              messages: [...state().messages, newMessage],
            };
          }),
        ),
      (state) =>
        this._cleanedMessage$.pipe(
          concatMap(({ message }) => {
            if (message === undefined || message === '') {
              return EMPTY;
            }
            return this.sendMessage(message).pipe(
              map((resp: OpenAI.ChatCompletion) => {
                return {
                  messages: [
                    ...state().messages,
                    {
                      decryptedData: {
                        content: resp.choices[0].message.content,
                      },
                      // we add 1 to the created seconds because for some reason the OpenAI API seems to round down the created timestamp
                      // which can cause messages to be out of order if the connection is fast enough
                      createdAt: new Date((resp.created + 1) * 1000), // convert s to ms
                    },
                  ],
                };
              }),
            );
          }),
        ),
    ],
    selectors: (state) => ({
      orderedMessageList: () => {
        const messageList = state().messages;
        messageList.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        return messageList;
      },
    }),
  });

  // selectors
  public readonly messages = this.state.orderedMessageList;
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

  private decryptMessage(record: MessagesResponse): Message {
    const base64EncryptedData = record.data;
    const conversation = this._conversationService.conversation();

    if (!conversation) {
      throw new Error('No conversation selected');
    }

    try {
      const decryptedData = this._cryptoService.openSealedBox(
        Base64.toUint8Array(base64EncryptedData),
        conversation.keyPair,
      );

      return {
        createdAt: new Date(record.created),
        decryptedData: parseMessageData(decryptedData),
      };
    } catch (error) {
      // Show to the user the message failed to decrypt
      console.error('Message decryption failed', error);
      return {
        createdAt: new Date(record.created),
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

  private sendMessage(message: string): Observable<OpenAI.ChatCompletion> {
    const conversation = this._conversationService.conversation();
    if (!conversation) {
      throw new Error('No conversation selected');
    }

    return from(
      this._openAi.chat.completions.create({
        messages: [{ role: 'user', content: message }],
        model: this._modelService.selectedModel().id,
        metadata: {
          cognos: {
            agent_id: this._agentService.selectedAgent().id,
            conversation_id: conversation.record.id,
          },
        },
      }),
    );
  }
}
