// Shared region/privacy-tier resolution so every surface that shows "where a
// model runs" — the composer model selector, the per-answer privacy receipt and
// the per-chat privacy panel — agrees on the flag and label for a given model or
// served-model snapshot. Country signals win over the coarse tier (a CH-hosted
// model in the `eu` tier still reads as Switzerland).

export type RegionTier = 'ch_only' | 'eu' | 'global';

// Minimal shape shared by the live catalogue `Model` and a decrypted message's
// served_* snapshot. All optional so an older message (no snapshot) or a partial
// catalogue entry still resolves — it just falls back to `global`.
export interface RegionInput {
  privacyTier?: string;
  hostingCountry?: string;
  hostingRegion?: string;
}

// resolveRegionTier collapses the country + tier signals into one of the three
// canonical tiers. Country is authoritative when it names CH/EU; otherwise the
// declared privacy tier decides; anything unknown is treated as global.
export const resolveRegionTier = (input: RegionInput): RegionTier => {
  const country = (input.hostingCountry ?? '').trim().toUpperCase();
  const region = (input.hostingRegion ?? '').trim().toUpperCase();
  if (country === 'CH' || region === 'CH' || input.privacyTier === 'ch_only') {
    return 'ch_only';
  }
  if (country === 'EU' || region === 'EU' || input.privacyTier === 'eu') {
    return 'eu';
  }
  return 'global';
};

// A compact flag for the hosting region. Falls back to a globe for non-CH/EU.
export const regionFlag = (input: RegionInput): string => {
  switch (resolveRegionTier(input)) {
    case 'ch_only':
      return '🇨🇭';
    case 'eu':
      return '🇪🇺';
    default:
      return '🌐';
  }
};

// The i18n key suffix (under e.g. `account.dataProcessing.regionBadge.*`) for a
// resolved tier — identical to the tier string, kept as a named helper so
// callers don't hardcode the coupling.
export const regionBadgeKey = (input: RegionInput): RegionTier =>
  resolveRegionTier(input);
