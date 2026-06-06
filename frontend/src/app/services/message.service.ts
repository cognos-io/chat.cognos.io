import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import { toObservable } from '@angular/core/rxjs-interop';

import {
  EMPTY,
  Observable,
  Subject,
  catchError,
  combineLatest,
  concatMap,
  exhaustMap,
  filter,
  finalize,
  from,
  map,
  of,
  startWith,
  switchMap,
  take,
  tap,
} from 'rxjs';

import { Base64 } from 'js-base64';
import { filterNil } from 'ngxtension/filter-nil';
import { signalSlice } from 'ngxtension/signal-slice';

import { generateConversationAgentId } from '@app/interfaces/agent';
import { Message, parseMessageData } from '@app/interfaces/message';

import { AgentService } from './agent.service';
import { AuthService } from './auth.service';
import {
  CognosApiService,
  CompleteResponse,
  CompletionMessageRequest,
  MessageListResponse,
  MessageRecord,
} from './cognos-api.service';
import { ConversationService } from './conversation.service';
import { CryptoService } from './crypto.service';
import { ErrorService } from './error.service';
import { ModelService } from './model.service';
import { VaultService } from './vault.service';

export enum MessageStatus {
  None, // default state
  Fetching, // fetching message list
  ErrorFetching, // error state
  Decrypting, // decrypting messages
  Sending, // sending message and waiting for AI response
  ErrorSending, // error state
  LoadingMoreMessages, // loading more messages
  Success, // message sent successfully
}

interface MessageState {
  messages: Message[];
  status: MessageStatus;
  isNewConversation: boolean; // used to indicate if this is a new conversation
  currentPage: number;
  hasMoreMessages: boolean; // try to load more messages
}

const initialState: MessageState = {
  messages: [],
  status: MessageStatus.None,
  isNewConversation: false,
  currentPage: 1,
  hasMoreMessages: true,
};

export type MessageRequest = {
  requestId: string;
  content: string;
  parentMessageId?: string;
};

@Injectable({
  providedIn: 'root',
})
export class MessageService {
  private readonly _deleteMessages$ = new Subject<Array<string>>(); // Add a list of message IDs to delete
  private readonly _agentService = inject(AgentService);
  private readonly _authService = inject(AuthService);
  private readonly _conversationService = inject(ConversationService);
  private readonly _cryptoService = inject(CryptoService);
  private readonly _errorService = inject(ErrorService);
  private readonly _modelService = inject(ModelService);
  private readonly _api = inject(CognosApiService);
  private readonly _vaultService = inject(VaultService);

  private readonly pageSize = 100;

  // sources
  public readonly sendMessage$ = new Subject<MessageRequest>();
  private readonly _cleanedMessage$ = this.sendMessage$.pipe(
    map((raw) => ({ ...raw, content: raw.content?.trim() })),
    filter(({ content }) => content !== undefined && content !== ''),
  );
  private readonly _isNewConversation$ = new Subject<boolean>();

  // state
  private readonly state = signalSlice({
    initialState,
    sources: [
      // Clear messages when the vault is cleared or the user logs out
      this._vaultService.keyPair$.pipe(
        map((keyPair) => {
          if (keyPair) {
            return {};
          }

          return initialState;
        }),
      ),
      this._authService.logout$.pipe(
        map(() => {
          return initialState;
        }),
      ),

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
              return of(initialState);
            }
            if (state().isNewConversation) {
              // we don't need to load new messages if this is a new conversation
              return of({
                currentPage: 1,
                hasMoreMessages: true,
              });
            }

            this.state.resetState();

            const currentPage = 1;
            return this.loadMessages(conversation.record.id, currentPage).pipe(
              catchError(() => {
                this.state.setStatus(MessageStatus.ErrorFetching);
                return EMPTY;
              }),
              map((resp) => {
                const messages = resp.items;
                return {
                  ...initialState,
                  currentPage,
                  messages,
                  hasMoreMessages: resp.totalPages > currentPage,
                };
              }),
            );
          }),
        ),

      // when a message is sent, add it to the list of messages and send it to our upstream API
      this._cleanedMessage$.pipe(
        tap(() => {
          const conversation = this._conversationService.conversation();
          if (!conversation) {
            return;
          }
          this._conversationService.updateConversationUpdatedTimeNow({
            id: conversation.record.id,
          });
        }),
        exhaustMap((messageRequest) => {
          if (!messageRequest.parentMessageId) {
            // Take the most recent message as the parent message
            const messages = this.state.orderedMessageList();

            const lastMessage = messages[messages.length - 1];
            if (lastMessage) {
              messageRequest.parentMessageId = lastMessage.record_id;
            }
          }

          const msg: Message = {
            // this ID is a temporary id and we will update it when we get the response
            record_id: messageRequest.requestId,
            parentMessageId: messageRequest.parentMessageId,
            createdAt: new Date(),
            decryptedData: {
              content: messageRequest.content,
              owner_id: this._authService.user()?.['id'],
            },
          };

          this.state.addMessage(msg);

          const conversation = this._conversationService.conversation();

          // Create a new conversation if there is no conversation selected
          // and this is not a temporary conversation
          if (!conversation && !this._conversationService.isTemporaryConversation()) {
            this._isNewConversation$.next(true);
            this._conversationService.newConversation$.next({
              title: 'New Conversation',
            });

            return this._conversationService.conversation$.pipe(
              filterNil(),
              take(1),
              switchMap((newConversation) => {
                return combineLatest([
                  // Generate a conversation title based on the first message
                  this.generateAndSetConversationTitle(
                    newConversation.record,
                    messageRequest.content,
                  ).pipe(startWith(newConversation)),
                  // And send the message
                  this.sendMessage(messageRequest).pipe(
                    finalize(() => this._isNewConversation$.next(false)),
                    tap((resp) => {
                      this.state.updateMessageId({
                        oldId: messageRequest.requestId,
                        newId: resp.userMessageId ?? '',
                      });
                    }),
                  ),
                ]).pipe(
                  map(([, resp]) => {
                    return {
                      ...this.addCompletionMessageToState(resp),
                    };
                  }),
                );
              }),
            );
          }

          return this.sendMessage(messageRequest).pipe(
            tap((resp) => {
              this.state.updateMessageId({
                oldId: messageRequest.requestId,
                newId: resp.userMessageId ?? '',
              });
            }),
            map((resp) => {
              return this.addCompletionMessageToState(resp);
            }),
          );
        }),
      ),

      this._deleteMessages$.pipe(
        concatMap((messageIds) => {
          return this.deleteMessages(messageIds);
        }),
      ),
    ],
    selectors: (state) => ({
      orderedMessageList: () => {
        const messageList = [...state().messages];
        messageList.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
        return messageList;
      },
      reverseOrderedMessageList: () => {
        const messageList = [...state().messages];
        messageList.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        return messageList;
      },
    }),
    actionSources: {
      addMessage: (state, $: Observable<Message>) =>
        $.pipe(
          map((message) => {
            return {
              messages: [...state().messages, message],
            };
          }),
        ),
      removeLastMessage: (state, $: Observable<void>) =>
        $.pipe(
          map(() => {
            const messages = state().messages.slice(0, -1);
            return {
              messages,
            };
          }),
        ),

      nextPage: (state, $) =>
        $.pipe(
          concatMap(() => {
            if (!state().hasMoreMessages) {
              return EMPTY;
            }
            const conversation = this._conversationService.conversation();
            if (!conversation) {
              return EMPTY;
            }
            const currentPage = state().currentPage + 1;

            return this.loadMessages(conversation.record.id, currentPage).pipe(
              catchError(() => {
                this.state.setStatus(MessageStatus.ErrorFetching);
                return EMPTY;
              }),
              map((resp) => {
                const messages = resp.items;
                return {
                  currentPage,
                  status: MessageStatus.None,
                  messages: [...messages, ...state().messages],
                  hasMoreMessages: resp.totalPages > currentPage,
                };
              }),
            );
          }),
        ),
      updateMessageId: (state, $: Observable<{ oldId: string; newId: string }>) =>
        $.pipe(
          map(({ oldId, newId }) => {
            const messages = state().messages.map((msg) => {
              if (msg.record_id === oldId) {
                return {
                  ...msg,
                  record_id: newId,
                };
              }
              return msg;
            });
            return {
              messages,
            };
          }),
        ),
      deleteMessage: (
        state,
        $: Observable<{
          messageId: string;
          //   Delete the message and all its children (replies) (parentMessageId === messageId)
          deleteChildren: boolean;
          //   Delete the message and all its siblings (messages with the same parentMessageId and later in time)
          deleteSiblings: boolean;
        }>,
      ) =>
        $.pipe(
          map(({ messageId, deleteChildren, deleteSiblings }) => {
            let messages = state().messages;
            messages.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

            const messageToRemove = messages.find((msg) => msg.record_id === messageId);

            messages = messages.filter((msg) => {
              if (msg.record_id === messageId) {
                return false;
              }
              if (deleteChildren && msg.parentMessageId === messageId) {
                return false;
              }
              // Delete the message and all messages at the same level
              if (
                deleteSiblings &&
                messageToRemove &&
                msg.parentMessageId === messageToRemove.parentMessageId &&
                msg.createdAt >= messageToRemove.createdAt
              ) {
                return false;
              }
              return true;
            });
            return {
              messages,
            };
          }),
        ),
      setStatus: (state, $: Observable<MessageStatus>) =>
        $.pipe(
          map((status) => {
            return {
              status,
            };
          }),
        ),
      resetState: (state, $: Observable<void>) =>
        $.pipe(
          map(() => {
            return initialState;
          }),
        ),
      keepExpiringMessage: (state, $: Observable<Message>) =>
        $.pipe(
          concatMap((message) => {
            return this.persistKeptExpiringMessage(message);
          }),
        ),
    },
  });

  // selectors
  public readonly messages = this.state.orderedMessageList;
  public readonly messages$ = toObservable(this.messages);
  public readonly status = this.state.status;
  public readonly status$ = toObservable(this.status);

  public readonly nextPage = this.state.nextPage;
  public readonly resetState = this.state.resetState;

  public deleteMessage(msg: Message) {
    if (!msg.record_id) {
      return;
    }
    this._deleteMessages$.next([msg.record_id]);
  }

  public readonly keepExpiringMessage = this.state.keepExpiringMessage;

  // helper methods
  private fetchMessages(
    conversationId: string,
    page: number,
  ): Observable<MessageListResponse> {
    if (this.state().messages.length === 0) {
      this.state.setStatus(MessageStatus.Fetching);
    } else {
      this.state.setStatus(MessageStatus.LoadingMoreMessages);
    }

    return this._api.listConversationMessages(conversationId, page, this.pageSize);
  }

  private decryptMessage(record: MessageRecord): Message {
    const base64EncryptedData = record.data;
    const conversation = this._conversationService.conversation();

    if (!conversation) {
      throw new Error('No conversation selected');
    }

    let decryptedData: Message['decryptedData'];

    try {
      decryptedData = parseMessageData(
        this._cryptoService.openSealedBox(
          Base64.toUint8Array(base64EncryptedData),
          conversation.keyPair,
        ),
      );

      if (
        decryptedData.conversation_id &&
        decryptedData.conversation_id !== record.conversation
      ) {
        throw new Error('Message conversation binding mismatch');
      }
      if (
        decryptedData.parent_message_id !== undefined &&
        decryptedData.parent_message_id !== record.parent_message
      ) {
        throw new Error('Message parent binding mismatch');
      }
    } catch (error) {
      // Show to the user the message failed to decrypt
      console.error('Message decryption failed', error);
      decryptedData = {
        content: 'Failed to decrypt message',
      };
    }

    return {
      record_id: record.id,
      createdAt: new Date(record.created),
      expires: record.expires ? new Date(record.expires) : undefined,
      parentMessageId: record.parent_message,
      decryptedData,
    };
  }

  private loadMessages(
    conversationId: string,
    page: number,
  ): Observable<{
    page: number;
    perPage: number;
    totalItems: number;
    totalPages: number;
    items: Message[];
  }> {
    return this.fetchMessages(conversationId, page).pipe(
      tap(() => {
        this.state.setStatus(MessageStatus.Decrypting);
      }),
      map((response) => {
        return {
          ...response,
          items: response.items.map((record) => this.decryptMessage(record)),
        };
      }),
    );
  }

  private sendMessage(messageRequest: MessageRequest): Observable<CompleteResponse> {
    const conversation = this._conversationService.conversation();
    const isTemporaryConversation = this._conversationService.isTemporaryConversation();

    if (!conversation && !isTemporaryConversation) {
      throw new Error('No conversation selected');
    }

    this.state.setStatus(MessageStatus.Sending);

    const request = {
      messages: this.createMessageContext(),
      modelId: this._modelService.selectedModel().id,
      agentId: this._agentService.selectedAgent().id,
      parentMessageId: messageRequest.parentMessageId,
      requestId: messageRequest.requestId,
    };

    const response$ = isTemporaryConversation
      ? this._api.complete(request)
      : this._api.completeConversation(conversation!.record.id, request);

    return response$.pipe(
      catchError((err: unknown) => {
        this.state.setStatus(MessageStatus.ErrorSending);
        console.error('Error sending message');

        if (err instanceof HttpErrorResponse) {
          switch (err.status) {
            case 402:
              this._errorService.alert('Insufficient balance to send this message.');
              break;
            case 429:
              this._errorService.alert(
                'Rate limiting error, you are sending too many messages. Please wait a few seconds before sending another message.',
              );
              break;
            default:
              this._errorService.alert('An error occurred while sending the message.');
              break;
          }
        }

        this.state.removeLastMessage();
        return EMPTY;
      }),
      tap(() => {
        this.state.setStatus(MessageStatus.Success);
      }),
    );
  }

  private addCompletionMessageToState(resp: CompleteResponse): Partial<MessageState> {
    const messages = this.state().messages;
    const expires = resp.expiresAt ? new Date(resp.expiresAt) : undefined;

    const msg: Message = {
      parentMessageId: resp.assistantMessage.parentMessageId,
      record_id: resp.assistantMessage.id,
      createdAt: new Date(resp.assistantMessage.createdAt),
      expires,
      decryptedData: {
        content: resp.assistantMessage.content,
        agent_id: resp.assistantMessage.agentId,
        model_id: resp.assistantMessage.modelId,
      },
    };

    if (expires && resp.assistantMessage.parentMessageId) {
      messages.forEach((message) => {
        if (message.record_id === resp.assistantMessage.parentMessageId) {
          message.expires = expires;
        }
      });
    }

    return {
      messages: [...messages, msg],
    };
  }

  /**
   * Create a message context object based on the message history
   * to be used in the Cognos API request.
   *
   * As the new message has already been added to the state, we don't
   * need to include it as a parameter here.
   */
  private createMessageContext(): Array<CompletionMessageRequest> {
    const model = this._modelService.selectedModel();
    const context: Array<CompletionMessageRequest> = [];

    let usedContextLength = 0;
    // Rather than calling a tokenizer, estimate that 1 token is 2 characters
    const targetContextChars = model.inputContextLength * 2;

    for (const message of this.state.reverseOrderedMessageList()) {
      if (!message.decryptedData.content) {
        continue;
      }

      //  For now, rather than using tokens use characters.
      // TODO(ewan): Use tokens instead of characters
      const messageLength = message.decryptedData.content.length;

      if (usedContextLength + messageLength >= targetContextChars) {
        break;
      }

      // We start with the latest messages and work our way back so
      // we need to prepend the new message to the context to ensure
      // the order is correct.
      context.unshift({
        role: message.decryptedData.owner_id ? 'user' : 'assistant',
        content: message.decryptedData.content,
        // Adding a name can help the message differentiate participants
        // Prioritize: userId of who sent it -> agent -> model
        name:
          message.decryptedData.owner_id ??
          this._agentService.getAgent(message.decryptedData.agent_id).name ??
          this._modelService.getModel(message.decryptedData.model_id)?.name,
      });
      usedContextLength += messageLength;

      // TODO(ewan): If we haven't reached the max tokens,
      // can we fetch more messages from this conversation and parse them?
    }

    return context;
  }

  private generateConversationTitle(
    startingMessage: string,
  ): Observable<string | null> {
    return this._api
      .complete({
        maxOutputTokens: 15,
        persist: false,
        messages: [{ role: 'user', content: startingMessage }],
        modelId: this._modelService.selectedModel().id,
        agentId: generateConversationAgentId,
      })
      .pipe(
        catchError((err) => {
          console.error('Error generating conversation title', err);
          return EMPTY;
        }),
        map((resp) => resp.assistantMessage.content || null),
      );
  }

  private generateAndSetConversationTitle(
    conversation: { id: string; expiry_duration?: string },
    startingMessage: string,
  ): Observable<{ id: string; expiry_duration?: string }> {
    return this.generateConversationTitle(startingMessage).pipe(
      filterNil(),
      switchMap((title) => {
        // Use max the first 10 words
        title = title.split(' ').slice(0, 10).join(' ');
        return this._conversationService.editConversation(
          conversation.id,
          conversation.expiry_duration ?? '',
          { title },
        );
      }),
    );
  }

  private deleteMessages(messageIds: Array<string>): Observable<Partial<MessageState>> {
    return from(messageIds).pipe(
      concatMap((messageId) => {
        // This will remove the message and all it's children due to the CASCADE delete
        return this._api.deleteMessage(messageId).pipe(
          map(() => {
            // Rather than load all the messages from the server, reset the state minus affected messages
            let messages = this.state().messages;

            messages = messages.filter((msg) => msg.record_id !== messageId);

            return {
              messages,
            };
          }),
        );
      }),
    );
  }

  private persistKeptExpiringMessage(
    message: Message,
  ): Observable<Partial<MessageState>> {
    // Updates a message in the backend to remove the expiry time
    if (!message.record_id) {
      return EMPTY;
    }

    return this._api.updateMessage(message.record_id, true).pipe(
      map(() => {
        return {
          messages: this.state().messages.map((msg) => {
            if (msg.record_id === message.record_id) {
              return {
                ...msg,
                expires: undefined,
              };
            }
            return msg;
          }),
        };
      }),
    );
  }
}
