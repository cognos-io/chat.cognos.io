import { HttpClient, HttpHeaders } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';

import PocketBase from 'pocketbase';

import { Observable, map } from 'rxjs';

import { Model, ModelsCatalogueResponse, PrivacyTier } from '@app/interfaces/model';

import { environment } from '@environments/environment';

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

  private authHeaders(): HttpHeaders {
    const token = this._pb.authStore.token;
    if (!token) {
      return new HttpHeaders();
    }

    return new HttpHeaders({
      Authorization: token,
    });
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
