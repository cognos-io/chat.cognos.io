import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import PocketBase from 'pocketbase';

import { Observable, map } from 'rxjs';

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
  description: string;
  privacy_tier: PrivacyTier;
  tags?: ApiTag[];
  content_types: Array<'text'>;
  input_context_tokens: number;
  max_output_tokens?: number;
  pricing: ApiPricing;
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

interface ApiConversationRequest {
  data: string;
  expiry_duration?: string;
}

interface ApiMessageUpdateRequest {
  clear_expires: boolean;
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

@Injectable({
  providedIn: 'root',
})
export class CognosApiService {
  private readonly _http = inject(HttpClient);
  private readonly _pb = inject(PocketBase);
  private readonly _baseUrl = environment.pocketbaseBaseUrl;

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

  deleteMessage(messageId: string): Observable<void> {
    return this._http.delete<void>(`${this._baseUrl}/api/v1/messages/${messageId}`, {
      headers: this.authHeaders(),
    });
  }

  complete(request: CompleteRequest): Observable<CompleteResponse> {
    return this._http
      .post<ApiCompleteResponse>(
        `${this._baseUrl}/api/v1/completions`,
        this.mapCompleteRequest(request),
        {
          headers: this.authHeaders(),
        },
      )
      .pipe(map((response) => this.mapCompleteResponse(response)));
  }

  completeConversation(
    conversationId: string,
    request: CompleteRequest,
  ): Observable<CompleteResponse> {
    return this._http
      .post<ApiCompleteResponse>(
        `${this._baseUrl}/api/v1/conversations/${conversationId}/complete`,
        this.mapCompleteRequest(request),
        {
          headers: this.authHeaders(),
        },
      )
      .pipe(map((response) => this.mapCompleteResponse(response)));
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
    return {
      messages: request.messages,
      model_id: request.modelId,
      agent_id: request.agentId,
      parent_message_id: request.parentMessageId,
      request_id: request.requestId,
      max_output_tokens: request.maxOutputTokens,
      persist: request.persist,
    };
  }

  private mapCompleteResponse(response: ApiCompleteResponse): CompleteResponse {
    return {
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
    };
  }

  private mapModel(model: ApiModel): Model {
    return Model.parse({
      id: model.id,
      name: model.name,
      slug: model.slug,
      providerId: model.provider_id,
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
      isEligible: model.is_eligible,
      ineligibilityReason: model.ineligibility_reason,
    });
  }
}
