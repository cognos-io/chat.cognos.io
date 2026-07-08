import { MessageData } from '@app/interfaces/message';
import { Model } from '@app/interfaces/model';

import { RegionInput } from './region';

// Resolved "what actually served this answer" used by the per-answer privacy
// receipt and the per-chat privacy panel.
export interface ServedModelInfo {
  modelName: string;
  providerName: string;
  region: RegionInput;
}

// resolveServedModel prefers the immutable served_* snapshot captured
// server-side at completion time (the ground truth of what served the turn) and
// falls back to the live catalogue entry for the requested model_id — older
// messages predate the snapshot, so the fallback keeps the receipt truthful for
// them (accepting that a relabelled catalogue could drift). Returns undefined
// when neither is available (e.g. a user message, or an unknown model_id).
export const resolveServedModel = (
  data: MessageData | undefined,
  model: Model | undefined,
): ServedModelInfo | undefined => {
  if (data?.served_model_name) {
    return {
      modelName: data.served_model_name,
      providerName: data.served_provider_name ?? '',
      region: {
        privacyTier: data.served_privacy_tier,
        hostingCountry: data.served_hosting_country,
        hostingRegion: data.served_hosting_region,
      },
    };
  }
  if (model) {
    return {
      modelName: model.displayName || model.name,
      providerName: model.providerName ?? '',
      region: {
        privacyTier: model.privacyTier,
        hostingCountry: model.hostingCountry,
        hostingRegion: model.hostingRegion,
      },
    };
  }
  return undefined;
};
