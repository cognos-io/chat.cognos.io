import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import PocketBase from 'pocketbase';

import { Observable, map } from 'rxjs';

import { Model, ModelsCatalogueResponse, PrivacyTier } from '@app/interfaces/model';

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
  provider_model_id: string;
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

  private authHeaders(): HttpHeaders {
    const token = this._pb.authStore.token;
    if (!token) {
      return new HttpHeaders();
    }

    return new HttpHeaders({
      Authorization: token,
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
      providerModelId: model.provider_model_id,
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
