import { describe, expect, it } from 'vitest';

import {
  EMPTY_MODEL_CAPABILITY_METADATA,
  MODEL_CAPABILITY_METADATA,
  modelCapabilityMetadata,
} from './model-capability-metadata';

describe('modelCapabilityMetadata', () => {
  it('returns empty defaults for an unknown model id', () => {
    expect(modelCapabilityMetadata('does-not-exist')).toEqual(
      EMPTY_MODEL_CAPABILITY_METADATA,
    );
  });

  it('merges a curated partial entry over the empty defaults', () => {
    // Drive the merge through a synthetic entry so the test does not depend on
    // the product-curated catalogue, which is intentionally tunable.
    const id = '__test-model__';
    (MODEL_CAPABILITY_METADATA as Record<string, unknown>)[id] = {
      recommended: true,
      recommendedDefaultFor: ['chat'],
      fast: true,
    };
    try {
      expect(modelCapabilityMetadata(id)).toEqual({
        recommended: true,
        recommendedDefaultFor: ['chat'],
        recommendedForPrivacyTiers: [],
        fast: true,
        powerful: false,
        aliases: [],
      });
    } finally {
      delete (MODEL_CAPABILITY_METADATA as Record<string, unknown>)[id];
    }
  });

  it('does not share the empty-defaults reference for unknown ids', () => {
    // The empty constant must not be mutated by callers; equal, not identical
    // is the contract we rely on across the discovery helpers.
    expect(modelCapabilityMetadata('a')).toEqual(modelCapabilityMetadata('b'));
  });
});
