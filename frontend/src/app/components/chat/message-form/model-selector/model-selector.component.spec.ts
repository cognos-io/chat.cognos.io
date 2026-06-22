import { describe, expect, it } from 'vitest';

import { Model } from '@app/interfaces/model';

import { modelSupportsCapability } from './model-selector.component';

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
    isEligible: true,
    ...overrides,
  };
}

describe('modelSupportsCapability', () => {
  const textModel = makeModel({ id: 'text', supportsImageGeneration: false });
  const imageModel = makeModel({ id: 'image', supportsImageGeneration: true });

  it('passes every model when no capability is required', () => {
    expect(modelSupportsCapability(textModel, null)).toBe(true);
    expect(modelSupportsCapability(imageModel, null)).toBe(true);
  });

  it('keeps only image-capable models when image generation is required', () => {
    expect(modelSupportsCapability(imageModel, 'image_generation')).toBe(true);
    expect(modelSupportsCapability(textModel, 'image_generation')).toBe(false);
  });
});
