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
  description: z.string(),
  privacyTier: PrivacyTier,
  tags: z.array(Tag).default([]),
  contentTypes: z.array(ContentType).default(['text']),
  inputContextLength: z.number(),
  maxOutputTokens: z.number().optional(),
  pricing: Pricing,
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
  description: 'Fetching the active model catalogue from Cognos.',
  privacyTier: 'global',
  tags: [],
  contentTypes: ['text'],
  inputContextLength: 8_192,
  pricing: {
    inputUsdPerMillionTokens: 0,
    outputUsdPerMillionTokens: 0,
  },
  isEligible: false,
};
