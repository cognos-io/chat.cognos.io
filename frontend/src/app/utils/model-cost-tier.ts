import { Pricing } from '@app/interfaces/model';

// Model cost tiers give users a plain low/medium/high signal instead of raw
// per-token prices. The tier is derived from the model's own USD pricing, so
// it stays correct automatically as the catalogue changes — no per-model field
// to maintain.

export type ModelCostTier = 'low' | 'medium' | 'high';

// Thresholds on the blended USD cost per million tokens (input + output). A
// model at or below `low` is low; at or below `medium` is medium; above is
// high. Chosen so a typical cheap open model lands "low", a mid GPT/Sonnet-class
// model lands "medium", and frontier models (Opus-class) land "high".
export const MODEL_COST_TIER_THRESHOLDS = {
  low: 5,
  medium: 20,
} as const;

export const MODEL_COST_TIER_LABEL: Record<ModelCostTier, string> = {
  low: 'Low cost',
  medium: 'Medium cost',
  high: 'High cost',
};

// blendedModelCostUsd sums the input and output per-million-token prices into a
// single comparable figure. Invalid values (NaN, negative, missing) are
// clamped to 0 so a malformed catalogue entry can never throw or rank as
// expensive.
export const blendedModelCostUsd = (
  pricing: Partial<Pricing> | null | undefined,
): number => {
  const clamp = (value: number | undefined): number =>
    typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
  if (!pricing) {
    return 0;
  }
  return (
    clamp(pricing.inputUsdPerMillionTokens) + clamp(pricing.outputUsdPerMillionTokens)
  );
};

export const deriveModelCostTier = (
  pricing: Partial<Pricing> | null | undefined,
): ModelCostTier => {
  const blended = blendedModelCostUsd(pricing);
  if (blended <= MODEL_COST_TIER_THRESHOLDS.low) {
    return 'low';
  }
  if (blended <= MODEL_COST_TIER_THRESHOLDS.medium) {
    return 'medium';
  }
  return 'high';
};
