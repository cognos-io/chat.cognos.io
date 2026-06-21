import { Model } from '@app/interfaces/model';

/**
 * Localised, per-model description for a catalogue row.
 *
 * Blurbs live in the i18n catalogues under `models.description.<model id>` and
 * describe the model itself (capability/positioning), not where it is hosted.
 * Falls back to the catalogue's own description when a model has no keyed blurb
 * (e.g. a newly added or non-surfaced model).
 */
export function localizedModelDescription(
  model: Model,
  translate: (key: string) => string,
): string {
  const key = 'models.description.' + model.id;
  const text = translate(key);
  return text && text !== key ? text : model.description;
}
