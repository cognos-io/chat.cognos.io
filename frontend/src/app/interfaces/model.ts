import { z } from 'zod';

import { Tag } from './tag';

export const PrivacyTier = z.enum(['ch_only', 'eu', 'global']);
export type PrivacyTier = z.infer<typeof PrivacyTier>;

export const ContentType = z.enum(['text']);
export type ContentType = z.infer<typeof ContentType>;

export const Pricing = z.object({
  inputUsdPerMillionTokens: z.number(),
  outputUsdPerMillionTokens: z.number(),
});
export type Pricing = z.infer<typeof Pricing>;

export const Model = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  providerId: z.string(),
  providerName: z.string().optional(),
  description: z.string(),
  privacyTier: PrivacyTier,
  tags: z.array(Tag).default([]),
  contentTypes: z.array(ContentType).default(['text']),
  inputContextLength: z.number(),
  maxOutputTokens: z.number().optional(),
  pricing: Pricing,
  noRetention: z.boolean().optional(),
  isOpenSource: z.boolean().optional(),
  hostingCountry: z.string().optional(),
  hostingRegion: z.string().optional(),
  supportsImageGeneration: z.boolean().default(false),
  // Objective capability flags synced from the provider catalogue (Requesty).
  // Vision = can read images as input (distinct from image generation).
  supportsVision: z.boolean().default(false),
  // File input = accepts native files (PDF) as a document block. Curated.
  supportsFileInput: z.boolean().default(false),
  supportsToolCalling: z.boolean().default(false),
  supportsWebSearch: z.boolean().default(false),
  supportsComputerUse: z.boolean().default(false),
  // Compaction capability metadata (spec docs/specs/client-side-compaction.md
  // §6.4). The planner reads these capabilities and never branches on model IDs.
  eligibleForCompaction: z.boolean().default(false),
  supportsStructuredOutput: z.boolean().default(false),
  supportsCacheHints: z.boolean().default(false),
  // Per-family chars-per-token heuristic for rough draft estimates. 0 => use the
  // global default.
  approxCharsPerToken: z.number().default(0),
  // Ordered reasoning-effort tiers this model accepts (e.g. ['off','low',
  // 'medium','high']). Empty means the model takes no effort parameter, so the
  // composer shows no effort selector for it.
  reasoningEfforts: z.array(z.string()).default([]),
  // The effort tier preselected when the user hasn't chosen one. Only
  // meaningful when reasoningEfforts is non-empty.
  defaultReasoningEffort: z.string().optional(),
  isEligible: z.boolean(),
  ineligibilityReason: z.string().optional(),
});
export type Model = z.infer<typeof Model>;

export const ModelsCatalogueResponse = z.object({
  privacyTier: PrivacyTier,
  preferredModelId: z.string().optional(),
  models: z.array(Model),
});
export type ModelsCatalogueResponse = z.infer<typeof ModelsCatalogueResponse>;

export const loadingModel: Model = {
  id: '',
  name: 'Loading models…',
  slug: 'loading-models',
  providerId: 'cognos',
  providerName: 'Cognos',
  description: 'Fetching the active model catalogue from Cognos.',
  privacyTier: 'global',
  tags: [],
  contentTypes: ['text'],
  inputContextLength: 8_192,
  pricing: {
    inputUsdPerMillionTokens: 0,
    outputUsdPerMillionTokens: 0,
  },
  noRetention: false,
  isOpenSource: false,
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
};
