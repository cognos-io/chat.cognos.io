// Curated, product-owned capability metadata keyed by the stable model id (the
// slug returned by /api/v1/models, e.g. "claude-opus-4-8"). These labels are
// subjective and MUST be curated by product — never inferred from a model's
// name or price (see docs/specs/composer-model-discovery.md §6.2 and the
// "fast/powerful are subjective" risk in §12). Unknown ids resolve to empty
// metadata so the catalogue can grow without code changes.

// Purposes a model can be a recommended default for. Drives contextual default
// resolution (e.g. image tool active → prefer an image-capable recommendation).
export type ModelPurpose = 'chat' | 'image' | 'reasoning' | 'long_context';

export interface ModelCapabilityMetadata {
  // Surfaced under the "Recommended" filter and used as a default candidate.
  recommended: boolean;
  // The purposes this model is a good recommended default for.
  recommendedDefaultFor: ModelPurpose[];
  // Curated speed/power signals. Not derivable from public metadata, so they
  // are explicit here rather than guessed.
  fast: boolean;
  powerful: boolean;
  // i18n keys (never literal copy) for the strength pills shown on the row.
  // Resolved through Transloco at render time.
  strengthKeys: string[];
  // Language-neutral extra search terms (e.g. a product shorthand). Per-language
  // synonyms live in the i18n synonym layer, not here.
  aliases: string[];
}

export const EMPTY_MODEL_CAPABILITY_METADATA: ModelCapabilityMetadata = {
  recommended: false,
  recommendedDefaultFor: [],
  fast: false,
  powerful: false,
  strengthKeys: [],
  aliases: [],
};

// Curated metadata keyed by model id. Entries are partial; missing fields fall
// back to EMPTY_MODEL_CAPABILITY_METADATA. Seeded conservatively and intended to
// be tuned by product — keep it reviewed whenever the catalogue changes.
export const MODEL_CAPABILITY_METADATA: Readonly<
  Record<string, Partial<ModelCapabilityMetadata>>
> = {};

// modelCapabilityMetadata resolves the full metadata for a model id, merging any
// curated entry over the empty defaults. Pure and total: an unknown id returns
// the empty defaults rather than throwing.
export function modelCapabilityMetadata(modelId: string): ModelCapabilityMetadata {
  const curated = MODEL_CAPABILITY_METADATA[modelId];
  if (!curated) {
    return EMPTY_MODEL_CAPABILITY_METADATA;
  }
  return { ...EMPTY_MODEL_CAPABILITY_METADATA, ...curated };
}
