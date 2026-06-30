import { Injectable, computed, inject, signal } from '@angular/core';

import { Model, PrivacyTier } from '@app/interfaces/model';
import { RequiredCapability } from '@app/utils/model-discovery';

import { environment } from '@environments/environment';

import { ModelService } from './model.service';

// ComposerToolId enumerates the optional tools the composer can enable for the
// next request. Each maps to a model capability that gates which models can run
// it. Add new tools here (and a capability check in modelSupportsCapability).
export type ComposerToolId = 'image_generation';

// ModelAutoSwitchNotice describes a model swap the composer made on the user's
// behalf when a tool was toggled (spec docs/specs/tool-aware-model-selection.md
// §4.4). Surfaced as a dismissible banner so the change — especially a privacy
// region change — is never silent.
export interface ModelAutoSwitchNotice {
  modelName: string;
  // 'to_image' when image generation was turned on, 'to_text' when it was off.
  direction: 'to_image' | 'to_text';
  // The new model's privacy tier, and whether the switch changed it (region).
  tier: PrivacyTier;
  tierChanged: boolean;
}

// ComposerToolsService is the single source of truth for which composer tools
// are enabled. The composer, the tools menu and the model selector all read it,
// so toggling a tool consistently drives send routing, model filtering and the
// auto-switch of the selected model to one that can do the active task.
@Injectable({ providedIn: 'root' })
export class ComposerToolsService {
  private readonly _modelService = inject(ModelService);

  readonly imageGenerationEnabled = signal(false);

  // The capability the current composer state requires of the model. Never null:
  // plain chat requires text completion, the image tool requires image
  // generation (spec §2). The model selector filters on this, and ModelService
  // resolves the selected model against it.
  readonly requiredCapability = computed<RequiredCapability>(() =>
    this.imageGenerationEnabled() ? 'image_generation' : 'text_completion',
  );

  // True when a tool is on but the selected model can't run it. With auto-switch
  // this only happens when no eligible image model exists at all (§4.5 fallback).
  readonly selectedModelUnsupported = computed(
    () =>
      this.imageGenerationEnabled() &&
      !this._modelService.selectedModel().supportsImageGeneration,
  );

  // The inverse mismatch: no tool routes to image generation, but the selected
  // model can only generate images. With text completion as a first-class
  // capability this is effectively unreachable, but kept as a backstop.
  readonly selectedModelTextIncompatible = computed(
    () =>
      !this.imageGenerationEnabled() &&
      !this._modelService.selectedModel().supportsTextCompletion,
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

  // The most recent auto-switch, or null. Rendered as a dismissible banner.
  private readonly _autoSwitchNotice = signal<ModelAutoSwitchNotice | null>(null);
  readonly autoSwitchNotice = this._autoSwitchNotice.asReadonly();

  constructor() {
    // Keep ModelService's active capability in sync from the start, so plain
    // chat resolves against text completion before any toggle.
    this._modelService.setActiveCapability(this.requiredCapability());
  }

  toggleImageGeneration(): void {
    this.applyImageGeneration(!this.imageGenerationEnabled(), true);
  }

  setImageGeneration(enabled: boolean): void {
    this.applyImageGeneration(enabled, true);
  }

  useSuggestedImageModel(): void {
    const model = this.suggestedImageModel();
    if (model) {
      this._modelService.selectModel(model.id);
    }
  }

  dismissAutoSwitch(): void {
    this._autoSwitchNotice.set(null);
  }

  reset(): void {
    // A state reset (e.g. leaving a conversation), not a user toggle — never
    // announce a switch for it.
    this.applyImageGeneration(false, false);
  }

  // applyImageGeneration flips the tool, pushes the new required capability to
  // ModelService (which re-resolves the selected model for the new context), and
  // — when the change is user-initiated — announces any resulting model switch.
  // Reads selectedModel() before and after: signals are pull-based, so `after`
  // already reflects the new capability synchronously.
  private applyImageGeneration(enabled: boolean, announce: boolean): void {
    const before = this._modelService.selectedModel();
    this.imageGenerationEnabled.set(enabled);
    this._modelService.setActiveCapability(this.requiredCapability());

    if (!announce) {
      this._autoSwitchNotice.set(null);
      return;
    }

    const after = this._modelService.selectedModel();
    if (after.id === before.id) {
      this._autoSwitchNotice.set(null);
      return;
    }

    this._autoSwitchNotice.set({
      modelName: after.displayName || after.name,
      direction: enabled ? 'to_image' : 'to_text',
      tier: after.privacyTier,
      tierChanged: before.privacyTier !== after.privacyTier,
    });
  }
}
