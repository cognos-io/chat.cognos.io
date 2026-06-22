import { Injectable, computed, inject, signal } from '@angular/core';

import { Model } from '@app/interfaces/model';

import { environment } from '@environments/environment';

import { ModelService } from './model.service';

// ComposerToolId enumerates the optional tools the composer can enable for the
// next request. Each maps to a model capability that gates which models can run
// it. Add new tools here (and a capability check in modelSupportsTool).
export type ComposerToolId = 'image_generation';

// ComposerToolsService is the single source of truth for which composer tools
// are enabled. The composer, the tools menu and the model selector all read it,
// so toggling a tool consistently drives send routing, model filtering and the
// unsupported-model warning.
@Injectable({ providedIn: 'root' })
export class ComposerToolsService {
  private readonly _modelService = inject(ModelService);

  readonly imageGenerationEnabled = signal(false);

  // The capability the active tool requires of the model, or null when no tool
  // that constrains the model is enabled.
  readonly requiredCapability = computed<ComposerToolId | null>(() =>
    this.imageGenerationEnabled() ? 'image_generation' : null,
  );

  // True when a tool is on but the selected model can't run it.
  readonly selectedModelUnsupported = computed(
    () =>
      this.imageGenerationEnabled() &&
      !this._modelService.selectedModel().supportsImageGeneration,
  );

  // The model we suggest switching to when the selected one can't generate
  // images: the configured preferred model if it's in the catalogue and
  // eligible, otherwise the first eligible image-capable model.
  readonly suggestedImageModel = computed<Model | null>(() => {
    const candidates = this._modelService
      .modelList()
      .filter((model) => model.supportsImageGeneration && model.isEligible);
    const preferred = candidates.find(
      (model) => model.id === environment.suggestedImageModelId,
    );
    return preferred ?? candidates[0] ?? null;
  });

  toggleImageGeneration(): void {
    this.imageGenerationEnabled.update((enabled) => !enabled);
  }

  setImageGeneration(enabled: boolean): void {
    this.imageGenerationEnabled.set(enabled);
  }

  useSuggestedImageModel(): void {
    const model = this.suggestedImageModel();
    if (model) {
      this._modelService.selectModel(model.id);
    }
  }

  reset(): void {
    this.imageGenerationEnabled.set(false);
  }
}
