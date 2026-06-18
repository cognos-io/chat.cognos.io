import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import PocketBase from 'pocketbase';

import { BehaviorSubject, of } from 'rxjs';

import { loadingModel } from '@app/interfaces/model';

import { AuthService } from './auth.service';
import { ModelService } from './model.service';

describe('ModelService', () => {
  let service: ModelService;
  let httpController: HttpTestingController;
  let authUser$: BehaviorSubject<unknown>;
  let updatePreferredModel: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    authUser$ = new BehaviorSubject<unknown>(null);
    updatePreferredModel = vi.fn().mockReturnValue(of({}));

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        ModelService,
        {
          provide: AuthService,
          useValue: {
            user$: authUser$,
            updatePreferredModel,
          },
        },
        {
          provide: PocketBase,
          useValue: {
            authStore: {
              token: 'test-token',
            },
          },
        },
      ],
    });

    service = TestBed.inject(ModelService);
    httpController = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    httpController.verify();
    TestBed.resetTestingModule();
  });

  it('loads the backend model catalogue after login', () => {
    authUser$.next({ id: 'user-1' });

    const request = httpController.expectOne('http://localhost:8090/api/v1/models');
    expect(request.request.method).toBe('GET');
    expect(request.request.headers.get('Authorization')).toBe('Bearer test-token');

    request.flush({
      privacy_tier: 'global',
      preferred_model_id: 'llama-3-3-infomaniak',
      models: [
        {
          id: 'llama-3-3-infomaniak',
          name: 'Llama 3.3',
          slug: 'llama-3-3-infomaniak',
          provider_id: 'infomaniak',
          provider_name: 'Infomaniak',
          description: 'Swiss-hosted model',
          privacy_tier: 'ch_only',
          tags: [{ title: 'general-purpose' }],
          content_types: ['text'],
          input_context_tokens: 128000,
          max_output_tokens: 8192,
          pricing: {
            input_usd_per_million_tokens: 0,
            output_usd_per_million_tokens: 0,
          },
          no_retention: true,
          is_open_source: true,
          hosting_country: 'CH',
          hosting_region: 'switzerland',
          is_eligible: true,
        },
      ],
    });

    expect(service.modelList()).toHaveLength(1);
    expect(service.selectedModel().id).toBe('llama-3-3-infomaniak');
    expect(service.selectedModel().providerId).toBe('infomaniak');
    expect(service.selectedModel().providerName).toBe('Infomaniak');
    expect(service.selectedModel().noRetention).toBe(true);
    expect(service.selectedModel().isOpenSource).toBe(true);
    expect(service.selectedModel().hostingCountry).toBe('CH');
    expect(service.getModel('llama-3-3-infomaniak')?.name).toBe('Llama 3.3');
  });

  it('prefers the first eligible model and ignores ineligible selections', () => {
    authUser$.next({ id: 'user-1' });

    const request = httpController.expectOne('http://localhost:8090/api/v1/models');
    request.flush({
      privacy_tier: 'eu',
      preferred_model_id: 'global-model',
      models: [
        {
          id: 'global-model',
          name: 'Global Model',
          slug: 'global-model',
          provider_id: 'other',
          description: 'Unavailable for this user',
          privacy_tier: 'global',
          tags: [],
          content_types: ['text'],
          input_context_tokens: 32000,
          pricing: {
            input_usd_per_million_tokens: 1,
            output_usd_per_million_tokens: 2,
          },
          is_eligible: false,
          ineligibility_reason: 'model privacy tier exceeds user privacy tier',
        },
        {
          id: 'eu-model',
          name: 'EU Model',
          slug: 'eu-model',
          provider_id: 'infomaniak',
          description: 'Eligible model',
          privacy_tier: 'eu',
          tags: [],
          content_types: ['text'],
          input_context_tokens: 64000,
          pricing: {
            input_usd_per_million_tokens: 1,
            output_usd_per_million_tokens: 2,
          },
          is_eligible: true,
        },
      ],
    });

    expect(service.selectedModel().id).toBe('eu-model');

    // An ineligible model must neither change the selection nor be persisted.
    service.selectModel('global-model');
    expect(service.selectedModel().id).toBe('eu-model');
    expect(updatePreferredModel).not.toHaveBeenCalled();

    // An eligible explicit selection is persisted to the user record.
    service.selectModel('eu-model');
    expect(service.selectedModel().id).toBe('eu-model');
    expect(updatePreferredModel).toHaveBeenCalledExactlyOnceWith('eu-model');
  });

  it('falls back to the first returned model when none are eligible', () => {
    authUser$.next({ id: 'user-1' });

    const request = httpController.expectOne('http://localhost:8090/api/v1/models');
    request.flush({
      privacy_tier: 'ch_only',
      models: [
        {
          id: 'global-model',
          name: 'Global Model',
          slug: 'global-model',
          provider_id: 'other',
          description: 'Unavailable for this user',
          privacy_tier: 'global',
          tags: [],
          content_types: ['text'],
          input_context_tokens: 32000,
          pricing: {
            input_usd_per_million_tokens: 1,
            output_usd_per_million_tokens: 2,
          },
          is_eligible: false,
          ineligibility_reason: 'model privacy tier exceeds user privacy tier',
        },
        {
          id: 'eu-model',
          name: 'EU Model',
          slug: 'eu-model',
          provider_id: 'infomaniak',
          description: 'Also unavailable for this user',
          privacy_tier: 'eu',
          tags: [],
          content_types: ['text'],
          input_context_tokens: 64000,
          pricing: {
            input_usd_per_million_tokens: 1,
            output_usd_per_million_tokens: 2,
          },
          is_eligible: false,
          ineligibility_reason: 'model privacy tier exceeds user privacy tier',
        },
      ],
    });

    expect(service.selectedModel().id).toBe('global-model');
  });

  it('groups loaded models by provider id', () => {
    authUser$.next({ id: 'user-1' });

    const request = httpController.expectOne('http://localhost:8090/api/v1/models');
    request.flush({
      privacy_tier: 'global',
      models: [
        {
          id: 'infomaniak-a',
          name: 'Infomaniak A',
          slug: 'infomaniak-a',
          provider_id: 'infomaniak',
          description: '',
          privacy_tier: 'ch_only',
          tags: [],
          content_types: ['text'],
          input_context_tokens: 32000,
          pricing: {
            input_usd_per_million_tokens: 0,
            output_usd_per_million_tokens: 0,
          },
          is_eligible: true,
        },
        {
          id: 'infomaniak-b',
          name: 'Infomaniak B',
          slug: 'infomaniak-b',
          provider_id: 'infomaniak',
          description: '',
          privacy_tier: 'ch_only',
          tags: [],
          content_types: ['text'],
          input_context_tokens: 32000,
          pricing: {
            input_usd_per_million_tokens: 0,
            output_usd_per_million_tokens: 0,
          },
          is_eligible: true,
        },
        {
          id: 'other-a',
          name: 'Other A',
          slug: 'other-a',
          provider_id: 'other',
          description: '',
          privacy_tier: 'global',
          tags: [],
          content_types: ['text'],
          input_context_tokens: 32000,
          pricing: {
            input_usd_per_million_tokens: 0,
            output_usd_per_million_tokens: 0,
          },
          is_eligible: true,
        },
      ],
    });

    const grouped = service.groupedModels();
    expect(Object.keys(grouped).sort()).toEqual(['infomaniak', 'other']);
    expect(grouped['infomaniak'].map((m) => m.id)).toEqual([
      'infomaniak-a',
      'infomaniak-b',
    ]);
    expect(grouped['other'].map((m) => m.id)).toEqual(['other-a']);
  });

  it('ignores selectModel calls for unknown model ids', () => {
    authUser$.next({ id: 'user-1' });

    const request = httpController.expectOne('http://localhost:8090/api/v1/models');
    request.flush({
      privacy_tier: 'global',
      preferred_model_id: 'llama-3-3-infomaniak',
      models: [
        {
          id: 'llama-3-3-infomaniak',
          name: 'Llama 3.3',
          slug: 'llama-3-3-infomaniak',
          provider_id: 'infomaniak',
          description: '',
          privacy_tier: 'ch_only',
          tags: [],
          content_types: ['text'],
          input_context_tokens: 32000,
          pricing: {
            input_usd_per_million_tokens: 0,
            output_usd_per_million_tokens: 0,
          },
          is_eligible: true,
        },
      ],
    });

    expect(service.selectedModel().id).toBe('llama-3-3-infomaniak');

    // An attacker-supplied or stale id must not change selection — the
    // reducer returns {} for unknown candidates so selectedModelId stays put.
    service.selectModel('does-not-exist');
    expect(service.selectedModel().id).toBe('llama-3-3-infomaniak');
    expect(updatePreferredModel).not.toHaveBeenCalled();
  });

  it('resets to the initial state after logout', () => {
    authUser$.next({ id: 'user-1' });

    const request = httpController.expectOne('http://localhost:8090/api/v1/models');
    request.flush({
      privacy_tier: 'global',
      preferred_model_id: 'llama-3-3-infomaniak',
      models: [
        {
          id: 'llama-3-3-infomaniak',
          name: 'Llama 3.3',
          slug: 'llama-3-3-infomaniak',
          provider_id: 'infomaniak',
          description: 'Swiss-hosted model',
          privacy_tier: 'ch_only',
          tags: [{ title: 'general-purpose' }],
          content_types: ['text'],
          input_context_tokens: 128000,
          max_output_tokens: 8192,
          pricing: {
            input_usd_per_million_tokens: 0,
            output_usd_per_million_tokens: 0,
          },
          is_eligible: true,
        },
      ],
    });

    expect(service.modelList()).toHaveLength(1);

    authUser$.next(null);

    expect(service.modelList()).toEqual([]);
    expect(service.selectedModel()).toEqual(loadingModel);
  });
});
