import { describe, expect, it } from 'vitest';

import { blendedModelCostUsd, deriveModelCostTier } from './model-cost-tier';

describe('blendedModelCostUsd', () => {
  it('sums input and output per-million prices', () => {
    expect(
      blendedModelCostUsd({
        inputUsdPerMillionTokens: 3,
        outputUsdPerMillionTokens: 15,
      }),
    ).toBe(18);
  });

  it('clamps negative, NaN and missing prices to zero', () => {
    expect(
      blendedModelCostUsd({
        inputUsdPerMillionTokens: -5,
        outputUsdPerMillionTokens: Number.NaN,
      }),
    ).toBe(0);
    expect(blendedModelCostUsd({ inputUsdPerMillionTokens: 4 })).toBe(4);
    expect(blendedModelCostUsd(null)).toBe(0);
    expect(blendedModelCostUsd(undefined)).toBe(0);
  });
});

describe('deriveModelCostTier', () => {
  // Sunny path: representative models land in the expected tier.
  it('classifies a cheap open model as low', () => {
    expect(
      deriveModelCostTier({
        inputUsdPerMillionTokens: 0.2,
        outputUsdPerMillionTokens: 0.2,
      }),
    ).toBe('low');
  });

  it('classifies a mid-class model as medium', () => {
    expect(
      deriveModelCostTier({
        inputUsdPerMillionTokens: 3,
        outputUsdPerMillionTokens: 15,
      }),
    ).toBe('medium');
  });

  it('classifies a frontier model as high', () => {
    expect(
      deriveModelCostTier({
        inputUsdPerMillionTokens: 15,
        outputUsdPerMillionTokens: 75,
      }),
    ).toBe('high');
  });

  // Edge: exactly on a threshold stays in the lower tier (inclusive bounds).
  it('treats threshold boundaries as the lower tier', () => {
    expect(
      deriveModelCostTier({
        inputUsdPerMillionTokens: 5,
        outputUsdPerMillionTokens: 0,
      }),
    ).toBe('low');
    expect(
      deriveModelCostTier({
        inputUsdPerMillionTokens: 0,
        outputUsdPerMillionTokens: 20,
      }),
    ).toBe('medium');
    expect(
      deriveModelCostTier({
        inputUsdPerMillionTokens: 0,
        outputUsdPerMillionTokens: 20.01,
      }),
    ).toBe('high');
  });

  // Rainy: malformed pricing must not throw and ranks as the cheapest tier.
  it('defaults invalid pricing to low instead of throwing', () => {
    expect(deriveModelCostTier(null)).toBe('low');
    expect(
      deriveModelCostTier({
        inputUsdPerMillionTokens: Number.NaN,
        outputUsdPerMillionTokens: -100,
      }),
    ).toBe('low');
  });
});
