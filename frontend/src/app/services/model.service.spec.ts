import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { WritableSignal, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import PocketBase from 'pocketbase';

import { BehaviorSubject } from 'rxjs';

import { loadingModel } from '@app/interfaces/model';

import { AuthService } from './auth.service';
import { ModelService, resolveReasoningEffort } from './model.service';
import { ProjectService } from './project.service';
import { UserPreferencesService } from './user-preferences.service';

describe('resolveReasoningEffort', () => {
  const model = (overrides: Partial<typeof loadingModel>) => ({
    ...loadingModel,
    ...overrides,
  });

  it('returns empty when the model declares no efforts', () => {
    expect(resolveReasoningEffort(model({ reasoningEfforts: [] }), {})).toBe('');
  });

  it('prefers a remembered choice that the model still offers', () => {
    const m = model({
      id: 'm1',
      reasoningEfforts: ['low', 'medium', 'high'],
      defaultReasoningEffort: 'medium',
    });
    expect(resolveReasoningEffort(m, { m1: 'high' })).toBe('high');
  });

  it('falls back to the declared default when the remembered choice is stale', () => {
    const m = model({
      id: 'm1',
      reasoningEfforts: ['low', 'medium', 'high'],
      defaultReasoningEffort: 'medium',
    });
    // "ultra" is no longer offered by this model — ignore it.
    expect(resolveReasoningEffort(m, { m1: 'ultra' })).toBe('medium');
  });

  it('falls back to the first option when there is no valid default', () => {
    const m = model({ id: 'm1', reasoningEfforts: ['low', 'high'] });
    expect(resolveReasoningEffort(m, {})).toBe('low');
  });
});

describe('ModelService', () => {
  let service: ModelService;
  let httpController: HttpTestingController;
  let authUser$: BehaviorSubject<unknown>;
  let setDefaultModel: ReturnType<typeof vi.fn>;
  let setToolModelDefault: ReturnType<typeof vi.fn>;
  let markRecentModel: ReturnType<typeof vi.fn>;
  let defaultModelId: WritableSignal<string>;
  let toolModelDefaults: WritableSignal<Record<string, string>>;
  let hiddenModels: WritableSignal<string[]>;
  let selectedProject: WritableSignal<{
    decryptedData: { defaultModelId: string };
  } | null>;

  beforeEach(() => {
    authUser$ = new BehaviorSubject<unknown>(null);
    setDefaultModel = vi.fn();
    setToolModelDefault = vi.fn();
    markRecentModel = vi.fn();
    defaultModelId = signal('');
    toolModelDefaults = signal<Record<string, string>>({});
    hiddenModels = signal<string[]>([]);
    selectedProject = signal<{
      decryptedData: { defaultModelId: string };
    } | null>(null);

    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        ModelService,
        {
          provide: AuthService,
          useValue: {
            user$: authUser$,
          },
        },
        {
          // The default model is the single preferences source of truth now.
          provide: UserPreferencesService,
          useValue: {
            defaultModelId,
            setDefaultModel,
            setToolModelDefault,
            markRecentModel,
            toolModelDefaults,
            hiddenModels,
          },
        },
        {
          provide: ProjectService,
          useValue: { selectedProject },
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
    expect(setDefaultModel).not.toHaveBeenCalled();
    expect(markRecentModel).not.toHaveBeenCalled();

    // An eligible explicit selection is persisted as the default preference and
    // recorded as recently used (the default stays implicit, spec §5.6).
    service.selectModel('eu-model');
    expect(service.selectedModel().id).toBe('eu-model');
    expect(setDefaultModel).toHaveBeenCalledExactlyOnceWith('eu-model');
    expect(markRecentModel).toHaveBeenCalledExactlyOnceWith('eu-model');
  });

  it('uses the persisted default model once preferences provide it', () => {
    authUser$.next({ id: 'user-1' });
    const request = httpController.expectOne('http://localhost:8090/api/v1/models');
    request.flush({
      privacy_tier: 'global',
      models: [makeModel('model-a'), makeModel('model-b')],
    });

    // Before preferences decrypt, the first eligible model is active.
    expect(service.selectedModel().id).toBe('model-a');

    // When the decrypted default arrives it wins reactively (no race).
    defaultModelId.set('model-b');
    expect(service.selectedModel().id).toBe('model-b');
  });

  it('filters image-only models out of the default text-completion context', () => {
    authUser$.next({ id: 'user-1' });
    const request = httpController.expectOne('http://localhost:8090/api/v1/models');
    request.flush({
      privacy_tier: 'global',
      models: [
        makeModel('image-only', {
          supports_image_generation: true,
          supports_text_completion: false,
        }),
        makeModel('text-model'),
      ],
    });

    // The default context is text completion, so an image-only model is never
    // resolved as the selected model (spec §4.1).
    expect(service.selectedModel().id).toBe('text-model');
  });

  it('auto-switches between text and image models as the context changes', () => {
    authUser$.next({ id: 'user-1' });
    const request = httpController.expectOne('http://localhost:8090/api/v1/models');
    request.flush({
      privacy_tier: 'global',
      models: [
        makeModel('text-model'),
        makeModel('image-model', {
          supports_image_generation: true,
          supports_text_completion: false,
        }),
      ],
    });

    expect(service.selectedModel().id).toBe('text-model');

    // Turning the image tool on resolves to an image-capable model (§4.2).
    service.setActiveCapability('image_generation');
    expect(service.selectedModel().id).toBe('image-model');

    // Turning it off returns to the chat model — no image-only model is left
    // selected for text (the bug this feature fixes).
    service.setActiveCapability('text_completion');
    expect(service.selectedModel().id).toBe('text-model');
  });

  it('prefers the remembered per-context default for the active context', () => {
    authUser$.next({ id: 'user-1' });
    const request = httpController.expectOne('http://localhost:8090/api/v1/models');
    request.flush({
      privacy_tier: 'global',
      models: [
        makeModel('text-model'),
        makeModel('image-a', {
          supports_image_generation: true,
          supports_text_completion: false,
        }),
        makeModel('image-b', {
          supports_image_generation: true,
          supports_text_completion: false,
        }),
      ],
    });

    service.setActiveCapability('image_generation');
    // A remembered image default wins over the first eligible image model.
    toolModelDefaults.set({ image_generation: 'image-b' });
    expect(service.selectedModel().id).toBe('image-b');
  });

  it('persists an explicit pick to the active context slot, not the chat default', () => {
    authUser$.next({ id: 'user-1' });
    const request = httpController.expectOne('http://localhost:8090/api/v1/models');
    request.flush({
      privacy_tier: 'global',
      models: [
        makeModel('text-model'),
        makeModel('image-a', {
          supports_image_generation: true,
          supports_text_completion: false,
        }),
      ],
    });

    // An image-context pick writes the tool default, never defaultModelId (§4.3).
    service.setActiveCapability('image_generation');
    service.selectModel('image-a');
    expect(setToolModelDefault).toHaveBeenCalledExactlyOnceWith(
      'image_generation',
      'image-a',
    );
    expect(setDefaultModel).not.toHaveBeenCalled();

    // A chat-context pick still writes the chat default.
    service.setActiveCapability('text_completion');
    service.selectModel('text-model');
    expect(setDefaultModel).toHaveBeenCalledExactlyOnceWith('text-model');
  });

  it('prefers an eligible project default over the user default', () => {
    authUser$.next({ id: 'user-1' });
    const request = httpController.expectOne('http://localhost:8090/api/v1/models');
    request.flush({
      privacy_tier: 'global',
      models: [makeModel('model-a'), makeModel('model-b')],
    });

    defaultModelId.set('model-a'); // user default
    expect(service.selectedModel().id).toBe('model-a');

    // A project default outranks the user default for project chats.
    selectedProject.set({ decryptedData: { defaultModelId: 'model-b' } });
    expect(service.selectedModel().id).toBe('model-b');

    // A stale/ineligible project default is ignored, falling back to the user.
    selectedProject.set({ decryptedData: { defaultModelId: 'does-not-exist' } });
    expect(service.selectedModel().id).toBe('model-a');
  });

  it('ignores a persisted default that is ineligible or unknown', () => {
    authUser$.next({ id: 'user-1' });
    const request = httpController.expectOne('http://localhost:8090/api/v1/models');
    request.flush({
      privacy_tier: 'eu',
      models: [
        makeModel('eu-model', { privacy_tier: 'eu', is_eligible: true }),
        makeModel('global-model', { privacy_tier: 'global', is_eligible: false }),
      ],
    });

    defaultModelId.set('global-model'); // ineligible
    expect(service.selectedModel().id).toBe('eu-model');

    defaultModelId.set('does-not-exist'); // unknown
    expect(service.selectedModel().id).toBe('eu-model');
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
    expect(setDefaultModel).not.toHaveBeenCalled();
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

function makeModel(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id,
    name: id,
    slug: id,
    provider_id: 'infomaniak',
    description: '',
    privacy_tier: 'global',
    tags: [],
    content_types: ['text'],
    input_context_tokens: 32000,
    pricing: { input_usd_per_million_tokens: 0, output_usd_per_million_tokens: 0 },
    is_eligible: true,
    ...overrides,
  };
}
