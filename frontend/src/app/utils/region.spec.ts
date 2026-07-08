import { describe, expect, it } from 'vitest';

import { regionBadgeKey, regionFlag, resolveRegionTier } from './region';

describe('resolveRegionTier', () => {
  it.each([
    // Country wins for CH/EU regardless of the coarse tier.
    [{ hostingCountry: 'CH', privacyTier: 'eu' }, 'ch_only'],
    [{ hostingCountry: 'ch' }, 'ch_only'],
    [{ hostingRegion: 'CH' }, 'ch_only'],
    [{ hostingCountry: 'EU', privacyTier: 'global' }, 'eu'],
    [{ hostingRegion: 'eu' }, 'eu'],
    // Tier decides when country is absent.
    [{ privacyTier: 'ch_only' }, 'ch_only'],
    [{ privacyTier: 'eu' }, 'eu'],
    [{ privacyTier: 'global' }, 'global'],
    // Unknown / empty falls back to global.
    [{}, 'global'],
    [{ hostingCountry: 'US' }, 'global'],
    [{ privacyTier: 'something-else' }, 'global'],
  ])('resolves %o to %s', (input, expected) => {
    expect(resolveRegionTier(input)).toBe(expected);
  });
});

describe('regionFlag', () => {
  it.each([
    [{ privacyTier: 'ch_only' }, '🇨🇭'],
    [{ privacyTier: 'eu' }, '🇪🇺'],
    [{ privacyTier: 'global' }, '🌐'],
    [{ hostingCountry: 'CH' }, '🇨🇭'],
    [{}, '🌐'],
  ])('maps %o to %s', (input, flag) => {
    expect(regionFlag(input)).toBe(flag);
  });
});

describe('regionBadgeKey', () => {
  it('returns the resolved tier as the i18n key suffix', () => {
    expect(regionBadgeKey({ hostingCountry: 'CH', privacyTier: 'eu' })).toBe('ch_only');
    expect(regionBadgeKey({})).toBe('global');
  });
});
