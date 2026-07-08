import { describe, expect, it } from 'vitest';

import { MessageData } from '@app/interfaces/message';
import { Model } from '@app/interfaces/model';

import { resolveRegionTier } from './region';
import { resolveServedModel } from './served-model';

const baseModel: Model = {
  id: 'apertus-70b',
  name: 'Apertus 70B (technical)',
  displayName: 'Apertus 70B',
  slug: 'apertus-70b',
  providerId: 'swiss-ai',
  providerName: 'Swiss AI',
  description: '',
  privacyTier: 'ch_only',
  tags: [],
  contentTypes: ['text'],
  inputContextLength: 8192,
  pricing: { inputUsdPerMillionTokens: 0, outputUsdPerMillionTokens: 0 },
  hostingCountry: 'CH',
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
};

describe('resolveServedModel', () => {
  it('prefers the served_* snapshot over the live catalogue', () => {
    // The catalogue model is CH, but the served snapshot pins an EU turn — the
    // snapshot must win so the receipt reflects what actually served it.
    const data = {
      content: 'hi',
      served_model_name: 'Fast 70B',
      served_provider_name: 'Requesty',
      served_privacy_tier: 'eu',
      served_hosting_country: 'DE',
      served_hosting_region: 'eu',
    } as unknown as MessageData;

    const info = resolveServedModel(data, baseModel);

    expect(info).toEqual({
      modelName: 'Fast 70B',
      providerName: 'Requesty',
      region: {
        privacyTier: 'eu',
        hostingCountry: 'DE',
        hostingRegion: 'eu',
      },
    });
    expect(resolveRegionTier(info!.region)).toBe('eu');
  });

  it('falls back to the live catalogue entry when no snapshot is present', () => {
    const data = { content: 'hi', model_id: 'apertus-70b' } as MessageData;

    const info = resolveServedModel(data, baseModel);

    expect(info).toEqual({
      modelName: 'Apertus 70B', // displayName preferred over technical name
      providerName: 'Swiss AI',
      region: {
        privacyTier: 'ch_only',
        hostingCountry: 'CH',
        hostingRegion: undefined,
      },
    });
    expect(resolveRegionTier(info!.region)).toBe('ch_only');
  });

  it('returns undefined when neither snapshot nor model is available', () => {
    expect(
      resolveServedModel({ content: 'hi' } as MessageData, undefined),
    ).toBeUndefined();
    expect(resolveServedModel(undefined, undefined)).toBeUndefined();
  });

  it('uses the technical name when displayName is empty in the fallback', () => {
    const info = resolveServedModel({ content: 'x' } as MessageData, {
      ...baseModel,
      displayName: '',
    });
    expect(info?.modelName).toBe('Apertus 70B (technical)');
  });
});
