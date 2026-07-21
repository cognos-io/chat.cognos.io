import { Injectable, computed, inject, signal } from '@angular/core';

import { Observable, catchError, map, of, switchMap } from 'rxjs';

import { signalSlice } from 'ngxtension/signal-slice';

import { Model, PrivacyTier, loadingModel } from '@app/interfaces/model';
import {
  CAPABILITY_CONTEXT_TEXT,
  RequiredCapability,
  capabilityContextKey,
  resolveDefaultModel,
} from '@app/utils/model-discovery';

import { Analytics, modelProp } from './analytics/analytics';
import { AuthService } from './auth.service';
import { CognosApiService } from './cognos-api.service';
import { ProjectService } from './project.service';
import { UserPreferencesService } from './user-preferences.service';

// resolveReasoningEffort picks the effort tier to use for a model: the user's
// remembered choice when it's still one the model offers, else the model's
// declared default, else its first option. Returns '' when the model takes no
// reasoning effort, meaning "send no reasoning parameter". Pure for testing.
export const resolveReasoningEffort = (
  model: Model,
  remembered: Record<string, string>,
): string => {
  const efforts = model.reasoningEfforts ?? [];
  if (efforts.length === 0) {
    return '';
  }
  const choice = remembered[model.id];
  if (choice && efforts.includes(choice)) {
    return choice;
  }
  if (model.defaultReasoningEffort && efforts.includes(model.defaultReasoningEffort)) {
    return model.defaultReasoningEffort;
  }
  return efforts[0];
};

interface ModelState {
  modelList: Model[];
  selectedModelId: string;
  // The user's current data-processing tier, echoed by /api/v1/models. Drives
  // which models are eligible.
  privacyTier: PrivacyTier;
}

const initialState: ModelState = {
  modelList: [],
  selectedModelId: '',
  privacyTier: 'eu',
};

@Injectable({
  providedIn: 'root',
})
export class ModelService {
  private readonly _authService = inject(AuthService);
  private readonly _api = inject(CognosApiService);
  private readonly _preferences = inject(UserPreferencesService);
  private readonly _projects = inject(ProjectService);
  private readonly _analytics = inject(Analytics);

  // The capability the composer currently requires (text completion by default,
  // image generation when that tool is on). Pushed in by ComposerToolsService —
  // ModelService must not depend on it (that would be a DI cycle), so the arrow
  // points the other way. Drives capability-aware selection + the per-context
  // default (docs/business_processes/model-capability-gating.md).
  private readonly _activeCapability = signal<RequiredCapability>('text_completion');

  // Declared before `state` so the selectedModel selector can read it.
  setActiveCapability(capability: RequiredCapability): void {
    this._activeCapability.set(capability);
  }

  private readonly state = signalSlice({
    initialState,
    sources: [
      this._authService.user$.pipe(
        switchMap((user) => {
          if (!user) {
            return of(initialState);
          }

          return this._api.getModels().pipe(
            // selectedModelId stays empty here; the active model is derived
            // (selectedModel selector) from the manual pick, then the user's
            // persisted default, then the first eligible model. That avoids a
            // race with the encrypted preferences, which decrypt after unlock.
            map((response) => ({
              modelList: response.models,
              privacyTier: response.privacyTier,
            })),
            catchError((error) => {
              console.error('Failed to load models', error);
              return of(initialState);
            }),
          );
        }),
      ),
    ],
    selectors: (state) => ({
      selectedModel: () => {
        const modelList = state.modelList();
        // Resolution is per the active capability context (tool-aware-model-
        // selection.md). Every candidate must be eligible AND capable of the
        // context: session pick → project default → per-context default →
        // recommended → first eligible. Because resolution is capability-gated,
        // toggling a tool re-resolves to the right model automatically — that is
        // the auto-switch (§4.2). Hidden/ineligible/incapable/stale ids fall
        // through; the final fallbacks keep a model selected regardless.
        const capability = this._activeCapability();
        const contextKey = capabilityContextKey(capability);
        // The "text" context default stays in defaultModelId (backward compat);
        // tool contexts read their remembered model from toolModelDefaults (§5).
        const perContextDefault =
          contextKey === CAPABILITY_CONTEXT_TEXT
            ? this._preferences.defaultModelId()
            : (this._preferences.toolModelDefaults()[contextKey] ?? '');
        return (
          resolveDefaultModel({
            models: modelList,
            sessionSelectedId: state.selectedModelId(),
            projectDefaultId:
              this._projects.selectedProject()?.decryptedData.defaultModelId,
            userDefaultId: perContextDefault,
            hiddenIds: this._preferences.hiddenModels(),
            requiredCapability: capability,
            privacyTier: state.privacyTier(),
          }) ??
          modelList[0] ??
          loadingModel
        );
      },
      groupedModels: () => {
        return state.modelList().reduce<Record<string, Array<Model>>>((acc, model) => {
          if (!acc[model.providerId]) {
            acc[model.providerId] = [];
          }
          acc[model.providerId].push(model);
          return acc;
        }, {});
      },
    }),
    actionSources: {
      selectModel: (state, $action: Observable<string>) => {
        return $action.pipe(
          map((id) => {
            const model = state().modelList.find((candidate) => candidate.id === id);
            if (!model || !model.isEligible) {
              return {};
            }
            // Picking a model also makes it the implicit default for the *active
            // capability context* (spec): a chat pick updates defaultModelId,
            // an image-context pick updates toolModelDefaults["image_generation"].
            // Selecting in one context never overwrites another's default, so a
            // user keeps a chat model and an image model independently. Selecting
            // also records the model as recently used.
            const contextKey = capabilityContextKey(this._activeCapability());
            if (contextKey === CAPABILITY_CONTEXT_TEXT) {
              this._preferences.setDefaultModel(id);
            } else {
              this._preferences.setToolModelDefault(contextKey, id);
            }
            this._preferences.markRecentModel(id);
            // Catalogue curation signal — the id is our catalogue data, not
            // user content.
            this._analytics.track('model_selected', { model: modelProp(id) });
            return {
              selectedModelId: id,
            };
          }),
        );
      },
    },
  });

  readonly selectedModel = this.state.selectedModel;
  readonly modelList = this.state.modelList;
  // Models the user may actually use (eligible for their privacy tier). Shared
  // so "eligible" is defined in one place across the pickers and settings.
  readonly eligibleModels = computed(() =>
    this.state.modelList().filter((model) => model.isEligible),
  );
  readonly selectModel = this.state.selectModel;
  readonly groupedModels = this.state.groupedModels;
  readonly privacyTier = this.state.privacyTier;

  // The reasoning-effort tier in force for the selected model — the value shown
  // in the composer and sent with completions. '' means the model takes none.
  readonly selectedReasoningEffort = computed(() =>
    resolveReasoningEffort(
      this.selectedModel(),
      this._preferences.modelReasoningEfforts(),
    ),
  );

  // Remember the user's reasoning-effort choice for the selected model, but only
  // when it's a tier that model actually offers.
  setReasoningEffort(effort: string): void {
    const model = this.selectedModel();
    if ((model.reasoningEfforts ?? []).includes(effort)) {
      this._preferences.setModelReasoningEffort(model.id, effort);
    }
  }

  getModel(id?: string): Model | undefined {
    if (!id) {
      return undefined;
    }

    return this.state().modelList.find((model) => model.id === id);
  }
}
