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
  tap,
} from 'rxjs';

import { Base64 } from 'js-base64';
import { filterNil } from 'ngxtension/filter-nil';
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
  isNewConversation: boolean; // used to indicate if this is a new conversation
}

const initialState: MessageState = {
  messages: [],
  status: MessageStatus.None,
  isNewConversation: false,
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
  private readonly _authService = inject(AuthService);
  private readonly _openAi = inject(OpenAI);

  private readonly pbMessagesCollection = this._pb.collection('messages');

  // sources
  public readonly sendMessage$ = new Subject<RawMessage>();
  private readonly _cleanedMessage$ = this.sendMessage$.pipe(
    map((raw) => ({ ...raw, message: raw.message?.trim() })),
    filter(({ message }) => message !== undefined && message !== ''),
  );
  private readonly _isNewConversation$ = new Subject<boolean>();

  // state
  private readonly state = signalSlice({
    initialState,
    sources: [
      this._isNewConversation$.pipe(
        map((isNewConversation) => {
          return {
            isNewConversation,
          };
        }),
      ),
      // messages need a key pair, and a conversation
      // when the conversation changes, load the messages from the backend
      (state) =>
        this._conversationService.conversation$.pipe(
          switchMap((conversation) => {
            if (!conversation) {
              return of({
                messages: [],
              });
            }
            if (state().isNewConversation) {
              // we don't need to load new messages if this is a new conversation
              return EMPTY;
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
          concatMap((raw) => {
            const msg: Message = {
              createdAt: new Date(),
              decryptedData: {
                content: raw.message || '',
                owner_id: this._authService.user()?.['id'],
              },
            };
            const conversation = this._conversationService.conversation();

            if (!conversation) {
              this._isNewConversation$.next(true);
              this._conversationService.newConversation$.next({
                title: 'New Conversation',
              });
              return this._conversationService.conversation$.pipe(
                filterNil(),
                tap(() => {
                  this.state.addMessage(msg);
                }),
                concatMap(() => {
                  return this.sendMessage(raw.message || '').pipe(
                    map((resp) => {
                      return {
                        messages: [
                          ...state().messages,
                          {
                            createdAt: new Date((resp.created + 1) * 1000),
                            decryptedData: {
                              content: resp.choices[0].message.content,
                              agent_id: this._agentService.selectedAgent().id,
                              model_id: this._modelService.selectedModel().id,
                            },
                          },
                        ],
                      };
                    }),
                    tap(() => this._isNewConversation$.next(false)),
                  );
                }),
              );
            }

            this.state.addMessage(msg);

            return this.sendMessage(raw.message || '').pipe(
              map((resp) => {
                return {
                  messages: [
                    ...state().messages,
                    {
                      createdAt: new Date((resp.created + 1) * 1000),
                      decryptedData: {
                        content: resp.choices[0].message.content,
                        agent_id: this._agentService.selectedAgent().id,
                        model_id: this._modelService.selectedModel().id,
                      },
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
    actionSources: {
      addMessage: (state, action$: Observable<Message>) =>
        action$.pipe(
          map((message) => {
            return {
              messages: [...state().messages, message],
            };
          }),
        ),
    },
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
