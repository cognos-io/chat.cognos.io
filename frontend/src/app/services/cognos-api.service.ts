import { HttpClient, HttpErrorResponse, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import PocketBase from 'pocketbase';

import { Observable, Subscriber, filter, map, take } from 'rxjs';

import {
  BillingApiResponse,
  CheckoutRequest,
  CheckoutResponse,
} from '@app/interfaces/billing';
import { ConversationRecord } from '@app/interfaces/conversation';
import { Model, ModelsCatalogueResponse, PrivacyTier } from '@app/interfaces/model';
import {
  ConversationPublicKeysResponse,
  ConversationSecretKeysResponse,
  UserKeyPairsResponse,
  UserPreferencesResponse,
} from '@app/types/pocketbase-types';

import { environment } from '@environments/environment';

export interface CompletionMessageRequest {
  role: 'user' | 'assistant' | 'system';
  content: string;
  name?: string;
}

export interface CompleteRequest {
  messages: CompletionMessageRequest[];
  modelId: string;
  agentId: string;
  parentMessageId?: string;
  requestId?: string;
  maxOutputTokens?: number;
  persist?: boolean;
}

export interface CompleteResponse {
  requestId?: string;
  userMessageId?: string;
  expiresAt?: string;
  assistantMessage: {
    id?: string;
    parentMessageId?: string;
    content: string;
    agentId: string;
    modelId: string;
    createdAt: string;
  };
  usage: {
    inputTokens: number;
    outputTokens: number;
    totalTokens: number;
    cacheCreationInputTokens: number;
    cacheReadInputTokens: number;
    costUSD: number;
    costCHF: number;
    costRappen: number;
    usedProviderCost: boolean;
  };
}

export type CompleteStreamEvent =
  | {
      type: 'delta';
      delta: string;
    }
  | {
      type: 'complete';
      response: CompleteResponse;
    }
  | {
      type: 'error';
      message: string;
    };

export interface MessageRecord {
  id: string;
  created: string;
  updated: string;
  data: string;
  conversation: string;
  parent_message?: string;
  expires?: string;
}

export interface MessageListResponse {
  page: number;
  perPage: number;
  totalItems: number;
  totalPages: number;
  items: MessageRecord[];
}

interface ApiPricing {
  input_usd_per_million_tokens: number;
  output_usd_per_million_tokens: number;
}

interface ApiTag {
  title: string;
}

interface ApiModel {
  id: string;
  name: string;
  slug: string;
  provider_id: string;
  provider_name?: string;
  description: string;
  privacy_tier: PrivacyTier;
  tags?: ApiTag[];
  content_types: Array<'text'>;
  input_context_tokens: number;
  max_output_tokens?: number;
  pricing: ApiPricing;
  no_retention?: boolean;
  is_open_source?: boolean;
  hosting_country?: string;
  hosting_region?: string;
  is_eligible: boolean;
  ineligibility_reason?: string;
}

interface ApiModelsCatalogueResponse {
  privacy_tier: PrivacyTier;
  preferred_model_id?: string;
  models: ApiModel[];
}

interface ApiCompleteRequest {
  messages: CompletionMessageRequest[];
  model_id: string;
  agent_id: string;
  parent_message_id?: string;
  request_id?: string;
  max_output_tokens?: number;
  persist?: boolean;
}

interface ApiCompleteResponse {
  request_id?: string;
  user_message_id?: string;
  expires_at?: string;
  assistant_message: {
    id?: string;
    parent_message_id?: string;
    content: string;
    agent_id: string;
    model_id: string;
    created_at: string;
  };
  usage: {
    input_tokens: number;
    output_tokens: number;
    total_tokens: number;
    cache_creation_input_tokens: number;
    cache_read_input_tokens: number;
    cost_usd: number;
    cost_chf: number;
    cost_rappen: number;
    used_provider_cost: boolean;
  };
}

interface ApiCompleteStreamDeltaEvent {
  type: 'delta';
  delta: string;
}

interface ApiCompleteStreamCompleteEvent {
  type: 'complete';
  response: ApiCompleteResponse;
}

interface ApiCompleteStreamErrorEvent {
  type: 'error';
  message: string;
}

export type ApiCompleteStreamEvent =
  | ApiCompleteStreamDeltaEvent
  | ApiCompleteStreamCompleteEvent
  | ApiCompleteStreamErrorEvent;

interface ApiConversationRequest {
  data: string;
  expiry_duration?: string;
}

interface ApiMessageUpdateRequest {
  clear_expires?: boolean;
  // Replacement encrypted blob, used to soft-delete by overwriting content
  // with a re-encrypted tombstone.
  data?: string;
}

interface ApiUserKeyPairCreateRequest {
  password_salt?: string;
  public_key: string;
  record_mac?: string;
  secret_key: string;
  unlock_scheme?: string;
}

interface ApiUserKeyPairUpdateRequest {
  record_mac: string;
}

interface ApiConversationPublicKeyCreateRequest {
  public_key: string;
  public_key_signature?: string;
}

interface ApiConversationPublicKeyUpdateRequest {
  public_key_signature: string;
}

interface ApiConversationSecretKeyCreateRequest {
  secret_key: string;
}

interface ApiRotateConversationKeyEntry {
  user_id: string;
  secret_key: string;
}

export interface ApiRotateConversationKeyRequest {
  /** User ids to soft-remove inside the same transaction as the rotation. */
  revoked_user_ids?: string[];
  public_key: string;
  public_key_signature?: string;
  /** One wrapped secret per post-revoke active participant. */
  wrapped_secret_keys: ApiRotateConversationKeyEntry[];
}

export interface ApiRotateConversationKeyResponse {
  conversation_id: string;
  key_version: number;
  revoked_user_ids: string[];
}

interface ApiCreatePublicShareRequest {
  public_key: string;
  wrapped_conversation_secret_key: string;
  share_secret: string;
}

export interface ApiCreatePublicShareResponse {
  token: string;
  key_version: number;
}

export interface ApiParticipantPublicShareResponse {
  token: string;
  public_key: string;
  share_secret: string;
  key_version: number;
}

export interface ApiPublicConversationResponse {
  conversation_id: string;
  data: string;
  conversation_public_key: string;
  wrapped_conversation_secret_key: string;
  key_version: number;
}

interface ApiVaultSessionResponse {
  wrap_key: string;
}

interface ApiVaultSessionUpsertRequest {
  wrap_key: string;
}

export interface VaultSession {
  wrapKey: string;
}

interface ApiUserPreferencesCreateRequest {
  data: string;
}

interface ApiUserPreferencesUpdateRequest {
  data: string;
}

// mapCompleteRequest and mapCompleteResponse are exported as pure helpers so
// the snake_case ↔ camelCase contract with the backend can be unit-tested
// directly. Without these as pinned helpers, a backend field rename would
// silently surface as `undefined` in CompleteResponse and the UI would
// degrade without a test failure to catch it.
export const mapCompleteRequest = (request: CompleteRequest): ApiCompleteRequest => ({
  messages: request.messages,
  model_id: request.modelId,
  agent_id: request.agentId,
  parent_message_id: request.parentMessageId,
  request_id: request.requestId,
  max_output_tokens: request.maxOutputTokens,
  persist: request.persist,
});

export const mapCompleteResponse = (
  response: ApiCompleteResponse,
): CompleteResponse => ({
  requestId: response.request_id,
  userMessageId: response.user_message_id,
  expiresAt: response.expires_at,
  assistantMessage: {
    id: response.assistant_message.id,
    parentMessageId: response.assistant_message.parent_message_id,
    content: response.assistant_message.content,
    agentId: response.assistant_message.agent_id,
    modelId: response.assistant_message.model_id,
    createdAt: response.assistant_message.created_at,
  },
  usage: {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    totalTokens: response.usage.total_tokens,
    cacheCreationInputTokens: response.usage.cache_creation_input_tokens,
    cacheReadInputTokens: response.usage.cache_read_input_tokens,
    costUSD: response.usage.cost_usd,
    costCHF: response.usage.cost_chf,
    costRappen: response.usage.cost_rappen,
    usedProviderCost: response.usage.used_provider_cost,
  },
});

export const parseCompleteStreamData = (data: string): CompleteStreamEvent => {
  const event = JSON.parse(data) as ApiCompleteStreamEvent;

  switch (event.type) {
    case 'delta':
      return {
        type: 'delta',
        delta: event.delta,
      };
    case 'complete':
      return {
        type: 'complete',
        response: mapCompleteResponse(event.response),
      };
    case 'error':
      return {
        type: 'error',
        message: event.message,
      };
    default:
      throw new Error('Unknown completion stream event type');
  }
};

@Injectable({
  providedIn: 'root',
})
export class CognosApiService {
  private readonly _http = inject(HttpClient);
  private readonly _pb = inject(PocketBase);
  private readonly _baseUrl = environment.pocketbaseBaseUrl;

  getBilling(): Observable<BillingApiResponse> {
    return this._http.get<BillingApiResponse>(`${this._baseUrl}/api/v1/billing`, {
      headers: this.authHeaders(),
    });
  }

  createCheckout(request: CheckoutRequest): Observable<CheckoutResponse> {
    return this._http.post<CheckoutResponse>(
      `${this._baseUrl}/api/v1/billing/checkout`,
      {
        plan: request.plan,
        business: request.business,
        return_url: request.returnUrl,
      },
      { headers: this.authHeaders() },
    );
  }

  getModels(): Observable<ModelsCatalogueResponse> {
    return this._http
      .get<ApiModelsCatalogueResponse>(`${this._baseUrl}/api/v1/models`, {
        headers: this.authHeaders(),
      })
      .pipe(
        map((response) => ({
          privacyTier: response.privacy_tier,
          preferredModelId: response.preferred_model_id,
          models: response.models.map((model) => this.mapModel(model)),
        })),
        map((response) => ModelsCatalogueResponse.parse(response)),
      );
  }

  listConversations(): Observable<ConversationRecord[]> {
    return this._http.get<ConversationRecord[]>(
      `${this._baseUrl}/api/v1/conversations`,
      {
        headers: this.authHeaders(),
      },
    );
  }

  createConversation(request: ApiConversationRequest): Observable<ConversationRecord> {
    return this._http.post<ConversationRecord>(
      `${this._baseUrl}/api/v1/conversations`,
      request,
      {
        headers: this.authHeaders(),
      },
    );
  }

  updateConversation(
    conversationId: string,
    request: ApiConversationRequest,
  ): Observable<ConversationRecord> {
    return this._http.patch<ConversationRecord>(
      `${this._baseUrl}/api/v1/conversations/${conversationId}`,
      request,
      {
        headers: this.authHeaders(),
      },
    );
  }

  deleteConversation(conversationId: string): Observable<void> {
    return this._http.delete<void>(
      `${this._baseUrl}/api/v1/conversations/${conversationId}`,
      {
        headers: this.authHeaders(),
      },
    );
  }

  listConversationMessages(
    conversationId: string,
    page: number,
    pageSize: number,
  ): Observable<MessageListResponse> {
    return this._http.get<MessageListResponse>(
      `${this._baseUrl}/api/v1/conversations/${conversationId}/messages?page=${page}&page_size=${pageSize}`,
      {
        headers: this.authHeaders(),
      },
    );
  }

  updateMessage(messageId: string, clearExpires: boolean): Observable<MessageRecord> {
    const request: ApiMessageUpdateRequest = { clear_expires: clearExpires };
    return this._http.patch<MessageRecord>(
      `${this._baseUrl}/api/v1/messages/${messageId}`,
      request,
      {
        headers: this.authHeaders(),
      },
    );
  }

  // softDeleteMessage overwrites a message's encrypted blob with a re-encrypted
  // tombstone, removing the content while keeping the record (and its role,
  // parent and timestamp inside the new blob).
  softDeleteMessage(messageId: string, data: string): Observable<MessageRecord> {
    const request: ApiMessageUpdateRequest = { data };
    return this._http.patch<MessageRecord>(
      `${this._baseUrl}/api/v1/messages/${messageId}`,
      request,
      {
        headers: this.authHeaders(),
      },
    );
  }

  deleteMessage(messageId: string): Observable<void> {
    return this._http.delete<void>(`${this._baseUrl}/api/v1/messages/${messageId}`, {
      headers: this.authHeaders(),
    });
  }

  complete(request: CompleteRequest): Observable<CompleteResponse> {
    return this.streamCompletion(`${this._baseUrl}/api/v1/completions`, request).pipe(
      filter(
        (event): event is Extract<CompleteStreamEvent, { type: 'complete' }> =>
          event.type === 'complete',
      ),
      map((event) => event.response),
      take(1),
    );
  }

  completeConversation(
    conversationId: string,
    request: CompleteRequest,
  ): Observable<CompleteResponse> {
    return this.streamCompletion(
      `${this._baseUrl}/api/v1/conversations/${conversationId}/complete`,
      request,
    ).pipe(
      filter(
        (event): event is Extract<CompleteStreamEvent, { type: 'complete' }> =>
          event.type === 'complete',
      ),
      map((event) => event.response),
      take(1),
    );
  }

  completeStream(
    request: CompleteRequest,
    signal?: AbortSignal,
  ): Observable<CompleteStreamEvent> {
    return this.streamCompletion(
      `${this._baseUrl}/api/v1/completions`,
      request,
      signal,
    );
  }

  completeConversationStream(
    conversationId: string,
    request: CompleteRequest,
    signal?: AbortSignal,
  ): Observable<CompleteStreamEvent> {
    return this.streamCompletion(
      `${this._baseUrl}/api/v1/conversations/${conversationId}/complete`,
      request,
      signal,
    );
  }

  // regenerateConversationStream produces a new assistant response to an
  // existing message (request.parentMessageId) without persisting a new user
  // message — the response becomes a sibling branch of the previous reply.
  regenerateConversationStream(
    conversationId: string,
    request: CompleteRequest,
    signal?: AbortSignal,
  ): Observable<CompleteStreamEvent> {
    return this.streamCompletion(
      `${this._baseUrl}/api/v1/conversations/${conversationId}/regenerate`,
      request,
      signal,
    );
  }

  getUserKeyPair(): Observable<UserKeyPairsResponse> {
    return this._http.get<UserKeyPairsResponse>(
      `${this._baseUrl}/api/v1/user-key-pair`,
      {
        headers: this.authHeaders(),
      },
    );
  }

  createUserKeyPair(
    request: ApiUserKeyPairCreateRequest,
  ): Observable<UserKeyPairsResponse> {
    return this._http.post<UserKeyPairsResponse>(
      `${this._baseUrl}/api/v1/user-key-pair`,
      request,
      {
        headers: this.authHeaders(),
      },
    );
  }

  updateUserKeyPair(
    keyPairId: string,
    request: ApiUserKeyPairUpdateRequest,
  ): Observable<UserKeyPairsResponse> {
    return this._http.patch<UserKeyPairsResponse>(
      `${this._baseUrl}/api/v1/user-key-pair/${keyPairId}`,
      request,
      {
        headers: this.authHeaders(),
      },
    );
  }

  getConversationPublicKey(
    conversationId: string,
  ): Observable<ConversationPublicKeysResponse> {
    return this._http.get<ConversationPublicKeysResponse>(
      `${this._baseUrl}/api/v1/conversations/${conversationId}/public-key`,
      {
        headers: this.authHeaders(),
      },
    );
  }

  createConversationPublicKey(
    conversationId: string,
    request: ApiConversationPublicKeyCreateRequest,
  ): Observable<ConversationPublicKeysResponse> {
    return this._http.post<ConversationPublicKeysResponse>(
      `${this._baseUrl}/api/v1/conversations/${conversationId}/public-key`,
      request,
      {
        headers: this.authHeaders(),
      },
    );
  }

  updateConversationPublicKey(
    conversationId: string,
    publicKeyId: string,
    request: ApiConversationPublicKeyUpdateRequest,
  ): Observable<ConversationPublicKeysResponse> {
    return this._http.patch<ConversationPublicKeysResponse>(
      `${this._baseUrl}/api/v1/conversations/${conversationId}/public-key/${publicKeyId}`,
      request,
      {
        headers: this.authHeaders(),
      },
    );
  }

  getConversationSecretKey(
    conversationId: string,
  ): Observable<ConversationSecretKeysResponse> {
    return this._http.get<ConversationSecretKeysResponse>(
      `${this._baseUrl}/api/v1/conversations/${conversationId}/secret-key`,
      {
        headers: this.authHeaders(),
      },
    );
  }

  createConversationSecretKey(
    conversationId: string,
    request: ApiConversationSecretKeyCreateRequest,
  ): Observable<ConversationSecretKeysResponse> {
    return this._http.post<ConversationSecretKeysResponse>(
      `${this._baseUrl}/api/v1/conversations/${conversationId}/secret-key`,
      request,
      {
        headers: this.authHeaders(),
      },
    );
  }

  /**
   * Rotate the conversation key, optionally revoking participants in the
   * same transaction. `revoked_user_ids` may be omitted for a pure rotation
   * (credential refresh, no membership change); when populated, the named
   * users are soft-removed before the new wrapped secret keys are
   * installed. The wrapped_secret_keys list must cover exactly the
   * post-revoke active set.
   */
  rotateConversationKey(
    conversationId: string,
    request: ApiRotateConversationKeyRequest,
  ): Observable<ApiRotateConversationKeyResponse> {
    return this._http.post<ApiRotateConversationKeyResponse>(
      `${this._baseUrl}/api/v1/conversations/${conversationId}/rotate`,
      request,
      {
        headers: this.authHeaders(),
      },
    );
  }

  // Public sharing. Create/get require the caller to be an Admin participant
  // (enforced server-side). The two getPublic* reads are deliberately
  // unauthenticated — the URL fragment, never sent here, is what decrypts the
  // payload — so they skip authHeaders entirely.
  createPublicShare(
    conversationId: string,
    request: ApiCreatePublicShareRequest,
  ): Observable<ApiCreatePublicShareResponse> {
    return this._http.post<ApiCreatePublicShareResponse>(
      `${this._baseUrl}/api/v1/conversations/${conversationId}/public-share`,
      request,
      {
        headers: this.authHeaders(),
      },
    );
  }

  getPublicShare(
    conversationId: string,
  ): Observable<ApiParticipantPublicShareResponse> {
    return this._http.get<ApiParticipantPublicShareResponse>(
      `${this._baseUrl}/api/v1/conversations/${conversationId}/public-share`,
      {
        headers: this.authHeaders(),
      },
    );
  }

  deletePublicShare(conversationId: string): Observable<void> {
    return this._http.delete<void>(
      `${this._baseUrl}/api/v1/conversations/${conversationId}/public-share`,
      {
        headers: this.authHeaders(),
      },
    );
  }

  getPublicConversation(token: string): Observable<ApiPublicConversationResponse> {
    return this._http.get<ApiPublicConversationResponse>(
      `${this._baseUrl}/api/v1/public/conversations/${token}`,
    );
  }

  listPublicConversationMessages(token: string): Observable<MessageListResponse> {
    return this._http.get<MessageListResponse>(
      `${this._baseUrl}/api/v1/public/conversations/${token}/messages`,
    );
  }

  getUserPreferences(): Observable<UserPreferencesResponse> {
    return this._http.get<UserPreferencesResponse>(
      `${this._baseUrl}/api/v1/user-preferences`,
      {
        headers: this.authHeaders(),
      },
    );
  }

  createUserPreferences(
    request: ApiUserPreferencesCreateRequest,
  ): Observable<UserPreferencesResponse> {
    return this._http.post<UserPreferencesResponse>(
      `${this._baseUrl}/api/v1/user-preferences`,
      request,
      {
        headers: this.authHeaders(),
      },
    );
  }

  getVaultSession(): Observable<VaultSession> {
    return this._http
      .get<ApiVaultSessionResponse>(`${this._baseUrl}/api/v1/vault-session`, {
        headers: this.authHeaders(),
      })
      .pipe(map((response) => ({ wrapKey: response.wrap_key })));
  }

  upsertVaultSession(wrapKey: string): Observable<VaultSession> {
    const request: ApiVaultSessionUpsertRequest = { wrap_key: wrapKey };
    return this._http
      .put<ApiVaultSessionResponse>(`${this._baseUrl}/api/v1/vault-session`, request, {
        headers: this.authHeaders(),
      })
      .pipe(map((response) => ({ wrapKey: response.wrap_key })));
  }

  deleteVaultSession(): Observable<void> {
    return this._http.delete<void>(`${this._baseUrl}/api/v1/vault-session`, {
      headers: this.authHeaders(),
    });
  }

  updateUserPreferences(
    preferencesId: string,
    request: ApiUserPreferencesUpdateRequest,
  ): Observable<UserPreferencesResponse> {
    return this._http.patch<UserPreferencesResponse>(
      `${this._baseUrl}/api/v1/user-preferences/${preferencesId}`,
      request,
      {
        headers: this.authHeaders(),
      },
    );
  }

  private authHeaders(): HttpHeaders {
    const token = this._pb.authStore.token;
    if (!token) {
      return new HttpHeaders();
    }

    return new HttpHeaders({
      Authorization: `Bearer ${token}`,
    });
  }

  private mapCompleteRequest(request: CompleteRequest): ApiCompleteRequest {
    return mapCompleteRequest(request);
  }

  private mapCompleteResponse(response: ApiCompleteResponse): CompleteResponse {
    return mapCompleteResponse(response);
  }

  private streamCompletion(
    url: string,
    request: CompleteRequest,
    externalSignal?: AbortSignal,
  ): Observable<CompleteStreamEvent> {
    return new Observable<CompleteStreamEvent>((subscriber) => {
      const controller = new AbortController();
      const abortFromExternal = () => controller.abort();

      if (externalSignal) {
        if (externalSignal.aborted) {
          controller.abort();
        } else {
          externalSignal.addEventListener('abort', abortFromExternal, { once: true });
        }
      }

      void (async () => {
        try {
          const authHeaders = this.authHeaders();
          const requestHeaders = authHeaders
            .keys()
            .reduce<Record<string, string>>((headers, key) => {
              const value = authHeaders.get(key);
              if (value) {
                headers[key] = value;
              }
              return headers;
            }, {});

          const response = await fetch(url, {
            method: 'POST',
            headers: {
              ...requestHeaders,
              Accept: 'text/event-stream',
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(this.mapCompleteRequest(request)),
            signal: controller.signal,
          });

          if (!response.ok) {
            let errorBody: unknown;
            try {
              errorBody = await response.json();
            } catch {
              errorBody = null;
            }

            subscriber.error(
              new HttpErrorResponse({
                status: response.status,
                statusText: response.statusText,
                url: response.url,
                error: errorBody,
              }),
            );
            return;
          }

          if (!response.body) {
            subscriber.error(new Error('Streaming response body was empty.'));
            return;
          }

          const reader = response.body.getReader();
          const decoder = new TextDecoder();
          let buffer = '';

          let done = false;
          while (!done) {
            const result = await reader.read();
            done = result.done;

            if (result.value) {
              buffer += decoder.decode(result.value, { stream: true });
              buffer = this.emitBufferedStreamEvents(buffer, subscriber);
            }
          }

          buffer += decoder.decode();
          buffer = this.emitBufferedStreamEvents(buffer, subscriber, true);

          if (buffer.trim() !== '') {
            subscriber.error(
              new Error('Streaming response ended with an incomplete event.'),
            );
            return;
          }

          subscriber.complete();
        } catch (error) {
          subscriber.error(error);
        }
      })();

      return () => {
        externalSignal?.removeEventListener('abort', abortFromExternal);
        controller.abort();
      };
    });
  }

  private emitBufferedStreamEvents(
    buffer: string,
    subscriber: Subscriber<CompleteStreamEvent>,
    flush = false,
  ): string {
    let remaining = buffer;
    let separatorIndex = remaining.indexOf('\n\n');

    while (separatorIndex >= 0) {
      const block = remaining.slice(0, separatorIndex);
      remaining = remaining.slice(separatorIndex + 2);

      const data = block
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice('data:'.length).trimStart())
        .join('\n');

      if (data !== '') {
        const event = parseCompleteStreamData(data);
        if (event.type === 'error') {
          subscriber.error(
            new Error(event.message || 'Failed to process completion stream.'),
          );
          return '';
        }
        subscriber.next(event);
      }

      separatorIndex = remaining.indexOf('\n\n');
    }

    if (flush) {
      const finalData = remaining
        .split('\n')
        .map((line) => line.trim())
        .filter((line) => line.startsWith('data:'))
        .map((line) => line.slice('data:'.length).trimStart())
        .join('\n');
      if (finalData !== '') {
        const event = parseCompleteStreamData(finalData);
        if (event.type === 'error') {
          subscriber.error(
            new Error(event.message || 'Failed to process completion stream.'),
          );
          return '';
        }
        subscriber.next(event);
      }
      return '';
    }

    return remaining;
  }

  private mapModel(model: ApiModel): Model {
    return Model.parse({
      id: model.id,
      name: model.name,
      slug: model.slug,
      providerId: model.provider_id,
      providerName: model.provider_name,
      description: model.description,
      privacyTier: model.privacy_tier,
      tags: model.tags ?? [],
      contentTypes: model.content_types,
      inputContextLength: model.input_context_tokens,
      maxOutputTokens: model.max_output_tokens,
      pricing: {
        inputUsdPerMillionTokens: model.pricing.input_usd_per_million_tokens,
        outputUsdPerMillionTokens: model.pricing.output_usd_per_million_tokens,
      },
      noRetention: model.no_retention,
      isOpenSource: model.is_open_source,
      hostingCountry: model.hosting_country,
      hostingRegion: model.hosting_region,
      isEligible: model.is_eligible,
      ineligibilityReason: model.ineligibility_reason,
    });
  }
}
