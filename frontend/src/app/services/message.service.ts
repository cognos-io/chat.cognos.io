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
  delay,
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
import { parseBackendDate } from '@app/utils/timestamp';

import { AgentService } from './agent.service';
import { AuthService } from './auth.service';
import {
  CognosApiService,
  CompleteResponse,
  CompleteStreamEvent,
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

type CompleteErrorBody = {
  error?: string;
  message?: string;
  next_step?: string;
};

// assertMessageBindings is the second-line defence after sealed-box decryption.
// Even if a sealed box opens (the keypair is correct), the decrypted payload
// must still claim to belong to the conversation and parent we read it from —
// otherwise an attacker who swaps ciphertext across rows could rebind a message
// into a different thread. Throwing here forces the catch in decryptMessage to
// show the "Failed to decrypt message" placeholder instead of trusting it.
export const assertMessageBindings = (
  decrypted: { conversation_id?: string; parent_message_id?: string },
  record: { conversation: string; parent_message?: string },
): void => {
  if (decrypted.conversation_id && decrypted.conversation_id !== record.conversation) {
    throw new Error('Message conversation binding mismatch');
  }
  if (
    decrypted.parent_message_id !== undefined &&
    decrypted.parent_message_id !== record.parent_message
  ) {
    throw new Error('Message parent binding mismatch');
  }
};

// buildCompletionMessageContext walks the conversation newest-first and
// produces the chronological prompt context. It enforces the per-message
// "would push us over the input budget" stop without ever sending plaintext
// fields we did not intend to (e.g. owner_id, agent_id, model_id are only
// consulted to pick the role + display name and never round-trip into the
// outgoing payload).
export const buildCompletionMessageContext = (
  messagesNewestFirst: ReadonlyArray<Message>,
  inputContextTokens: number,
  resolveAgentName: (id: string | undefined) => string | undefined,
  resolveModelName: (id: string | undefined) => string | undefined,
): CompletionMessageRequest[] => {
  const context: CompletionMessageRequest[] = [];
  // 1 token ~= 2 characters. We avoid a tokenizer dep here intentionally.
  const targetContextChars = inputContextTokens * 2;
  let usedContextLength = 0;

  for (const message of messagesNewestFirst) {
    const content = message.decryptedData.content;
    if (!content) {
      continue;
    }
    if (usedContextLength + content.length >= targetContextChars) {
      break;
    }

    const ownerId = message.decryptedData.owner_id;
    context.unshift({
      role: ownerId ? 'user' : 'assistant',
      content,
      name:
        ownerId ??
        resolveAgentName(message.decryptedData.agent_id) ??
        resolveModelName(message.decryptedData.model_id),
    });
    usedContextLength += content.length;
  }

  return context;
};

// buildCompletionMessages is the pure assistant-append step. It returns the
// new messages array — never mutating the existing entries — so that when the
// completion response carries an expiry, the parent message is updated via a
// fresh object instead of an in-place write to a signal-held record.
export const buildCompletionMessages = (
  existing: ReadonlyArray<Message>,
  resp: CompleteResponse,
): Message[] => {
  const expires = resp.expiresAt ? parseBackendDate(resp.expiresAt) : undefined;
  const parentId = resp.assistantMessage.parentMessageId;

  const assistant: Message = {
    parentMessageId: parentId,
    record_id: resp.assistantMessage.id,
    createdAt: parseBackendDate(resp.assistantMessage.createdAt),
    expires,
    decryptedData: {
      content: resp.assistantMessage.content,
      agent_id: resp.assistantMessage.agentId,
      model_id: resp.assistantMessage.modelId,
    },
  };

  const next =
    expires && parentId
      ? existing.map((message) =>
          message.record_id === parentId ? { ...message, expires } : message,
        )
      : [...existing];

  next.push(assistant);
  return next;
};

export const streamingAssistantMessageId = (requestId: string): string =>
  `${requestId}:assistant`;

export const applyCompletionStreamDelta = (
  existing: ReadonlyArray<Message>,
  request: MessageRequest,
  delta: string,
  agentId: string,
  modelId: string,
): Message[] => {
  const assistantId = streamingAssistantMessageId(request.requestId);
  const assistantIndex = existing.findIndex(
    (message) => message.record_id === assistantId,
  );

  if (assistantIndex >= 0) {
    return existing.map((message, index) =>
      index === assistantIndex
        ? {
            ...message,
            isStreaming: true,
            decryptedData: {
              ...message.decryptedData,
              content: `${message.decryptedData.content ?? ''}${delta}`,
            },
          }
        : message,
    );
  }

  return [
    ...existing,
    {
      record_id: assistantId,
      parentMessageId: request.parentMessageId,
      createdAt: new Date(),
      isStreaming: true,
      decryptedData: {
        content: delta,
        agent_id: agentId,
        model_id: modelId,
      },
    },
  ];
};

export const applyCompletionStreamResponse = (
  existing: ReadonlyArray<Message>,
  requestId: string,
  resp: CompleteResponse,
): Message[] => {
  const messages = existing
    .filter((message) => message.record_id !== streamingAssistantMessageId(requestId))
    .map((message) =>
      resp.userMessageId && message.record_id === requestId
        ? { ...message, record_id: resp.userMessageId }
        : message,
    );

  return buildCompletionMessages(messages, resp);
};

export const removeStreamingCompletionMessages = (
  existing: ReadonlyArray<Message>,
  requestId: string,
): Message[] => {
  const assistantId = streamingAssistantMessageId(requestId);
  return existing.filter(
    (message) => message.record_id !== requestId && message.record_id !== assistantId,
  );
};

export const resolveCompletionErrorMessage = (error: HttpErrorResponse): string => {
  switch (error.status) {
    case 402: {
      const body = error.error as CompleteErrorBody | null;
      if (typeof body?.message === 'string' && body.message.trim() !== '') {
        return body.message;
      }
      return 'Your account needs an active plan before you can keep chatting.';
    }
    case 429:
      return 'Rate limiting error, you are sending too many messages. Please wait a few seconds before sending another message.';
    default:
      return 'An error occurred while sending the message.';
  }
};

export const resolveCompletionFailureMessage = (error: unknown): string => {
  if (error instanceof HttpErrorResponse) {
    return resolveCompletionErrorMessage(error);
  }
  if (error instanceof Error && error.message.trim() !== '') {
    return error.message;
  }
  return 'An error occurred while sending the message.';
};

export const isCompletionAbortError = (error: unknown): boolean => {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return true;
  }
  return error instanceof Error && error.name === 'AbortError';
};

export const splitStreamDeltaForDisplay = (delta: string, chunkSize = 3): string[] => {
  const chars = Array.from(delta);
  if (chars.length <= chunkSize) {
    return [delta];
  }

  const chunks: string[] = [];
  for (let index = 0; index < chars.length; index += chunkSize) {
    chunks.push(chars.slice(index, index + chunkSize).join(''));
  }
  return chunks;
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

  private _activeCompletionAbort: AbortController | null = null;
  private _intentionalCompletionAbort = false;

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
            this.abortActiveCompletion();

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
                  ),
                ]).pipe(map(([, state]) => state));
              }),
            );
          }

          return this.sendMessage(messageRequest);
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
      assertMessageBindings(decryptedData, record);
    } catch (error) {
      // Show to the user the message failed to decrypt
      console.error('Message decryption failed', error);
      decryptedData = {
        content: 'Failed to decrypt message',
      };
    }

    return {
      record_id: record.id,
      // createdAt lives inside the encrypted blob (decryptedData), not a
      // plaintext record column — see MessageRecordData on the backend.
      createdAt: parseBackendDate(decryptedData.created_at),
      expires: record.expires ? parseBackendDate(record.expires) : undefined,
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

  private sendMessage(
    messageRequest: MessageRequest,
  ): Observable<Partial<MessageState>> {
    const conversation = this._conversationService.conversation();
    const isTemporaryConversation = this._conversationService.isTemporaryConversation();

    if (!conversation && !isTemporaryConversation) {
      throw new Error('No conversation selected');
    }

    const originConversationId = conversation?.record.id ?? null;

    this.abortActiveCompletion();
    const abortController = new AbortController();
    this._activeCompletionAbort = abortController;

    this.state.setStatus(MessageStatus.Sending);

    const request = {
      messages: this.createMessageContext(),
      modelId: this._modelService.selectedModel().id,
      agentId: this._agentService.selectedAgent().id,
      parentMessageId: messageRequest.parentMessageId,
      requestId: messageRequest.requestId,
    };

    let completed = false;

    const response$ = isTemporaryConversation
      ? this._api.completeStream(request, abortController.signal)
      : this._api.completeConversationStream(
          originConversationId!,
          request,
          abortController.signal,
        );

    const shouldApplyCompletionUpdate = (): boolean => {
      if (isTemporaryConversation) {
        return this._conversationService.isTemporaryConversation();
      }
      return (
        this._conversationService.conversation()?.record.id === originConversationId
      );
    };

    return response$.pipe(
      concatMap((event) => this.expandStreamEventForDisplay(event)),
      map((event: CompleteStreamEvent) => {
        if (!shouldApplyCompletionUpdate()) {
          return {};
        }

        switch (event.type) {
          case 'delta':
            return {
              messages: applyCompletionStreamDelta(
                this.state().messages,
                messageRequest,
                event.delta,
                request.agentId,
                request.modelId,
              ),
            };
          case 'complete':
            completed = true;
            return {
              status: MessageStatus.Success,
              messages: applyCompletionStreamResponse(
                this.state().messages,
                messageRequest.requestId,
                event.response,
              ),
            };
          case 'error':
            throw new Error(event.message);
        }
      }),
      catchError((err: unknown) => {
        if (this.consumeIntentionalCompletionAbort() || isCompletionAbortError(err)) {
          return EMPTY;
        }

        console.error('Error sending message');
        this._errorService.alert(resolveCompletionFailureMessage(err));

        if (!shouldApplyCompletionUpdate()) {
          return EMPTY;
        }

        return of({
          status: MessageStatus.ErrorSending,
          messages: removeStreamingCompletionMessages(
            this.state().messages,
            messageRequest.requestId,
          ),
        });
      }),
      finalize(() => {
        if (this._activeCompletionAbort === abortController) {
          this._activeCompletionAbort = null;
        }
        if (
          !completed &&
          !this._intentionalCompletionAbort &&
          shouldApplyCompletionUpdate() &&
          this.state.status() === MessageStatus.Sending
        ) {
          this.state.setStatus(MessageStatus.ErrorSending);
        }
        this.consumeIntentionalCompletionAbort();
      }),
    );
  }

  private abortActiveCompletion(): void {
    if (!this._activeCompletionAbort) {
      return;
    }

    this._intentionalCompletionAbort = true;
    this._activeCompletionAbort.abort();
    this._activeCompletionAbort = null;
  }

  private consumeIntentionalCompletionAbort(): boolean {
    if (!this._intentionalCompletionAbort) {
      return false;
    }

    this._intentionalCompletionAbort = false;
    return true;
  }

  private expandStreamEventForDisplay(
    event: CompleteStreamEvent,
  ): Observable<CompleteStreamEvent> {
    if (event.type !== 'delta') {
      return of(event);
    }

    const chunks = splitStreamDeltaForDisplay(event.delta);
    if (chunks.length <= 1) {
      return of(event);
    }

    return from(chunks).pipe(
      concatMap((chunk, index) => {
        const deltaEvent = { type: 'delta', delta: chunk } as CompleteStreamEvent;
        return index === 0 ? of(deltaEvent) : of(deltaEvent).pipe(delay(0));
      }),
    );
  }

  private createMessageContext(): Array<CompletionMessageRequest> {
    const model = this._modelService.selectedModel();
    return buildCompletionMessageContext(
      this.state.reverseOrderedMessageList(),
      model.inputContextLength,
      (id) => this._agentService.getAgent(id)()?.name,
      (id) => this._modelService.getModel(id)?.name,
    );
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
