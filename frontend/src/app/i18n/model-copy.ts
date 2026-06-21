import { Model } from '@app/interfaces/model';

// Providers we ship a localised residency tagline for. Anything else falls back
// to the generic key so the per-row description stays short and translatable
// instead of echoing a long English sentence from the catalogue.
const PROVIDERS_WITH_COPY = new Set(['requesty', 'infomaniak']);

/**
 * Translation-key suffix for a model's residency tagline, keyed by provider.
 * Use with: `t('models.description.' + modelDescriptionKey(model))`.
 */
export function modelDescriptionKey(model: Pick<Model, 'providerId'>): string {
  return PROVIDERS_WITH_COPY.has(model.providerId) ? model.providerId : 'default';
}
