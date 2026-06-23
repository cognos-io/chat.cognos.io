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
    slug: 'm',
    providerId: 'requesty',
    description: '',
    privacyTier: 'eu',
    tags: [],
    contentTypes: ['text'],
    inputContextLength: 1000,
    pricing: { inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 0 },
    supportsImageGeneration: false,
    reasoningEfforts: [],
    isEligible: true,
    ...overrides,
  };
}

function setup(options: { selected: Model; list: Model[] }) {
  const selectModel = vi.fn();
  TestBed.configureTestingModule({
    providers: [
      ComposerToolsService,
      {
        provide: ModelService,
        useValue: {
          selectedModel: signal(options.selected),
          modelList: signal(options.list),
          selectModel,
        },
      },
    ],
  });
  return { service: TestBed.inject(ComposerToolsService), selectModel };
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

  it('flags the selected model as unsupported only when the tool is on', () => {
    const { service } = setup({ selected: textModel, list: [textModel] });
    expect(service.selectedModelUnsupported()).toBe(false);
    service.setImageGeneration(true);
    expect(service.selectedModelUnsupported()).toBe(true);
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
});
