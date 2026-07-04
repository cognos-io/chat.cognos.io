import { describe, expect, it } from 'vitest';

import { Model } from '@app/interfaces/model';

import { localizedModelIneligibility } from './model-ineligibility';

function makeModel(overrides: Partial<Model> = {}): Model {
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
    isEligible: false,
    ...overrides,
  };
}

const t = (key: string, params?: Record<string, string>): string => {
  if (key === 'account.dataProcessing.tiers.ch_only.name') return 'Switzerland only';
  if (key === 'account.dataProcessing.tiers.eu.name')
    return 'Europe + Switzerland + UK';
  if (key === 'account.dataProcessing.tiers.global.name') return 'Global';
  if (key === 'chat.models.unavailable.generic') {
    return 'This model is not available for your account.';
  }
  if (key === 'chat.models.unavailable.privacyTier') {
    return `Needs ${params?.['required']} processing. Your current setting is ${params?.['current']}.`;
  }
  return key;
};

describe('localizedModelIneligibility', () => {
  it('explains privacy-tier locked models without leaking the raw backend reason', () => {
    const model = makeModel({
      privacyTier: 'eu',
      ineligibilityReason: 'model privacy tier exceeds user privacy tier',
    });

    expect(localizedModelIneligibility(model, 'ch_only', t)).toBe(
      'Needs Europe + Switzerland + UK processing. Your current setting is Switzerland only.',
    );
  });

  it('falls back to a generic account availability message for unknown reasons', () => {
    expect(
      localizedModelIneligibility(
        makeModel({ ineligibilityReason: 'provider unavailable' }),
        'eu',
        t,
      ),
    ).toBe('This model is not available for your account.');
  });
});
