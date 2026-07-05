import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { describe, expect, it, vi } from 'vitest';

import { Model } from '@app/interfaces/model';

import { ComposerToolsService } from './composer-tools.service';
import { ModelService } from './model.service';

function makeModel(overrides: Partial<Model>): Model {
  return {
    id: 'm',
    name: 'M',
    displayName: 'M',
    slug: 'm',
    providerId: 'requesty',
    description: '',
    privacyTier: 'eu',
    tags: [],
    contentTypes: ['text'],
    inputContextLength: 1000,
    pricing: { inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 0 },
    supportsTextCompletion: true,
    supportsImageGeneration: false,
    supportsVision: false,
    supportsFileInput: false,
    supportsToolCalling: false,
    supportsWebSearch: false,
    supportsComputerUse: false,
    eligibleForCompaction: false,
    supportsStructuredOutput: false,
    supportsCacheHints: false,
    approxCharsPerToken: 0,
    reasoningEfforts: [],
    isEligible: true,
    ...overrides,
  };
}

function setup(options: {
  selected: Model;
  list: Model[];
  // Optional resolver so a test can model ModelService's capability-aware
  // selection: setActiveCapability swaps the selected model for the context.
  resolveForCapability?: (capability: string) => Model;
}) {
  const selectModel = vi.fn();
  const selectedModel = signal(options.selected);
  const setActiveCapability = vi.fn((capability: string) => {
    if (options.resolveForCapability) {
      selectedModel.set(options.resolveForCapability(capability));
    }
  });
  TestBed.configureTestingModule({
    providers: [
      ComposerToolsService,
      {
        provide: ModelService,
        useValue: {
          selectedModel,
          modelList: signal(options.list),
          selectModel,
          setActiveCapability,
        },
      },
    ],
  });
  return {
    service: TestBed.inject(ComposerToolsService),
    selectModel,
    selectedModel,
    setActiveCapability,
  };
}

describe('ComposerToolsService', () => {
  const textModel = makeModel({ id: 'text-1', supportsImageGeneration: false });
  // The configured default (environment.suggestedImageModelId).
  const configuredImageModel = makeModel({
    id: 'gemini-2-5-flash-image',
    name: 'Gemini Image',
    supportsImageGeneration: true,
  });
  const otherImageModel = makeModel({
    id: 'other-image',
    name: 'Other Image',
    supportsImageGeneration: true,
  });

  it('toggles image generation off by default', () => {
    const { service } = setup({ selected: textModel, list: [textModel] });
    expect(service.imageGenerationEnabled()).toBe(false);
    service.toggleImageGeneration();
    expect(service.imageGenerationEnabled()).toBe(true);
    expect(service.requiredCapability()).toBe('image_generation');
  });

  it('requires text completion when no tool is active', () => {
    const { service } = setup({ selected: textModel, list: [textModel] });
    expect(service.requiredCapability()).toBe('text_completion');
    service.setImageGeneration(true);
    expect(service.requiredCapability()).toBe('image_generation');
  });

  it('pushes the active capability to ModelService on construction and toggle', () => {
    const { service, setActiveCapability } = setup({
      selected: textModel,
      list: [textModel],
    });
    expect(setActiveCapability).toHaveBeenCalledWith('text_completion');
    service.setImageGeneration(true);
    expect(setActiveCapability).toHaveBeenLastCalledWith('image_generation');
  });

  it('announces an auto-switch with the new model and direction', () => {
    const imageModel = makeModel({
      id: 'gemini',
      displayName: 'Gemini',
      supportsImageGeneration: true,
      supportsTextCompletion: false,
    });
    const { service } = setup({
      selected: textModel,
      list: [textModel, imageModel],
      resolveForCapability: (cap) =>
        cap === 'image_generation' ? imageModel : textModel,
    });
    expect(service.autoSwitchNotice()).toBeNull();

    service.setImageGeneration(true);
    expect(service.autoSwitchNotice()).toEqual(
      expect.objectContaining({ direction: 'to_image', modelName: 'Gemini' }),
    );

    service.setImageGeneration(false);
    expect(service.autoSwitchNotice()).toEqual(
      expect.objectContaining({ direction: 'to_text' }),
    );
  });

  it('flags a privacy-tier change in the auto-switch notice', () => {
    const chModel = makeModel({ id: 'ch', privacyTier: 'ch_only' });
    const imageModel = makeModel({
      id: 'gemini',
      privacyTier: 'eu',
      supportsImageGeneration: true,
      supportsTextCompletion: false,
    });
    const { service } = setup({
      selected: chModel,
      list: [chModel, imageModel],
      resolveForCapability: (cap) =>
        cap === 'image_generation' ? imageModel : chModel,
    });

    service.setImageGeneration(true);
    expect(service.autoSwitchNotice()?.tierChanged).toBe(true);
    expect(service.autoSwitchNotice()?.tier).toBe('eu');
  });

  it('emits no notice when a capable model needs no switch', () => {
    const multimodal = makeModel({ id: 'both', supportsImageGeneration: true });
    const { service } = setup({
      selected: multimodal,
      list: [multimodal],
      resolveForCapability: () => multimodal,
    });
    service.setImageGeneration(true);
    expect(service.autoSwitchNotice()).toBeNull();
  });

  it('dismisses the auto-switch notice', () => {
    const imageModel = makeModel({
      id: 'gemini',
      supportsImageGeneration: true,
      supportsTextCompletion: false,
    });
    const { service } = setup({
      selected: textModel,
      list: [textModel, imageModel],
      resolveForCapability: (cap) =>
        cap === 'image_generation' ? imageModel : textModel,
    });
    service.setImageGeneration(true);
    expect(service.autoSwitchNotice()).not.toBeNull();
    service.dismissAutoSwitch();
    expect(service.autoSwitchNotice()).toBeNull();
  });

  it('flags the selected model as unsupported only when the tool is on', () => {
    const { service } = setup({ selected: textModel, list: [textModel] });
    expect(service.selectedModelUnsupported()).toBe(false);
    service.setImageGeneration(true);
    expect(service.selectedModelUnsupported()).toBe(true);
  });

  it('flags an image-only model as text-incompatible only when the tool is off', () => {
    // Image-only model selected with the image tool off: a normal text send
    // would fail at the provider, so the composer must block it. Turning the
    // tool on routes to image generation instead, clearing the block.
    const imageOnlyModel = makeModel({
      id: 'gemini-2-5-flash-image',
      supportsImageGeneration: true,
      supportsTextCompletion: false,
    });
    const { service } = setup({
      selected: imageOnlyModel,
      list: [imageOnlyModel],
    });
    expect(service.selectedModelTextIncompatible()).toBe(true);
    service.setImageGeneration(true);
    expect(service.selectedModelTextIncompatible()).toBe(false);
  });

  it('never flags a text-capable model as text-incompatible', () => {
    const { service } = setup({ selected: textModel, list: [textModel] });
    expect(service.selectedModelTextIncompatible()).toBe(false);
    service.setImageGeneration(true);
    expect(service.selectedModelTextIncompatible()).toBe(false);
  });

  it('prefers the configured model as the suggestion', () => {
    const { service } = setup({
      selected: textModel,
      list: [textModel, otherImageModel, configuredImageModel],
    });
    expect(service.suggestedImageModel()?.id).toBe('gemini-2-5-flash-image');
  });

  it('falls back to the first eligible image model when the configured one is absent', () => {
    const { service } = setup({
      selected: textModel,
      list: [textModel, otherImageModel],
    });
    expect(service.suggestedImageModel()?.id).toBe('other-image');
  });

  it('switches to the suggested model on demand', () => {
    const { service, selectModel } = setup({
      selected: textModel,
      list: [textModel, configuredImageModel],
    });
    service.useSuggestedImageModel();
    expect(selectModel).toHaveBeenCalledWith('gemini-2-5-flash-image');
  });

  // ---- web search (spec docs/specs/web-search.md §4.2) --------------------

  const searchModel = makeModel({ id: 'search-1', supportsWebSearch: true });

  it('reports web search unsupported and disabled for a non-capable model', () => {
    const { service } = setup({ selected: textModel, list: [textModel] });
    expect(service.webSearchSupported()).toBe(false);
    expect(service.webSearchEnabled()).toBe(false);
  });

  it('is on by default for a capable model', () => {
    const { service } = setup({ selected: searchModel, list: [searchModel] });
    expect(service.webSearchSupported()).toBe(true);
    expect(service.webSearchEnabled()).toBe(true);
  });

  it('opts out per conversation without touching the model or capability', () => {
    const { service, selectModel, setActiveCapability } = setup({
      selected: searchModel,
      list: [searchModel],
    });
    setActiveCapability.mockClear();

    service.setWebSearch(false);
    expect(service.webSearchEnabled()).toBe(false);
    // Search never forces a model change or a capability change.
    expect(selectModel).not.toHaveBeenCalled();
    expect(service.requiredCapability()).toBe('text_completion');

    service.toggleWebSearch();
    expect(service.webSearchEnabled()).toBe(true);
  });

  it('clears the web-search opt-out on reset', () => {
    const { service } = setup({ selected: searchModel, list: [searchModel] });
    service.setWebSearch(false);
    expect(service.webSearchEnabled()).toBe(false);
    service.reset();
    expect(service.webSearchEnabled()).toBe(true);
  });

  it('stays off when the model cannot search even if opted in', () => {
    const { service } = setup({ selected: textModel, list: [textModel] });
    service.setWebSearch(true);
    expect(service.webSearchEnabled()).toBe(false);
  });

  it('recomputes to off when the model is switched to a non-capable one mid-conversation', () => {
    // Search is best-effort (spec §4.3): switching to a model that can't search
    // silently disables it — no error, no forced switch — and re-enables when a
    // capable model is selected again.
    const { service, selectedModel } = setup({
      selected: searchModel,
      list: [searchModel, textModel],
    });
    expect(service.webSearchEnabled()).toBe(true);

    selectedModel.set(textModel);
    expect(service.webSearchSupported()).toBe(false);
    expect(service.webSearchEnabled()).toBe(false);

    selectedModel.set(searchModel);
    expect(service.webSearchEnabled()).toBe(true);
  });

  it('preserves the per-conversation opt-out across a model switch', () => {
    // The opt-out is user intent for the conversation; a transient switch to a
    // non-capable model must not silently clear it once a capable model returns.
    const { service, selectedModel } = setup({
      selected: searchModel,
      list: [searchModel, textModel],
    });
    service.setWebSearch(false);
    expect(service.webSearchEnabled()).toBe(false);

    selectedModel.set(textModel);
    selectedModel.set(searchModel);
    // Still opted out — only reset() clears it.
    expect(service.webSearchEnabled()).toBe(false);
  });

  // ---- documents (spec docs/specs/document-generation.md §5.2) ------------

  it('is on by default regardless of model capability', () => {
    // No RequiredCapability gating: every text model can emit the block.
    const { service } = setup({ selected: textModel, list: [textModel] });
    expect(service.documentsEnabled()).toBe(true);
  });

  it('opts out per conversation without touching the model or capability', () => {
    const { service, selectModel, setActiveCapability } = setup({
      selected: textModel,
      list: [textModel],
    });
    setActiveCapability.mockClear();

    service.setDocuments(false);
    expect(service.documentsEnabled()).toBe(false);
    expect(selectModel).not.toHaveBeenCalled();
    expect(setActiveCapability).not.toHaveBeenCalled();
    expect(service.requiredCapability()).toBe('text_completion');

    service.toggleDocuments();
    expect(service.documentsEnabled()).toBe(true);
  });

  it('clears the documents opt-out on reset', () => {
    const { service } = setup({ selected: textModel, list: [textModel] });
    service.setDocuments(false);
    expect(service.documentsEnabled()).toBe(false);
    service.reset();
    expect(service.documentsEnabled()).toBe(true);
  });
});
