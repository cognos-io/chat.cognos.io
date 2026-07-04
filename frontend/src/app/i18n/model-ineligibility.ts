import { Model, PrivacyTier } from '@app/interfaces/model';

const PRIVACY_TIER_REASON = 'model privacy tier exceeds user privacy tier';

type TranslateFn = (key: string, params?: Record<string, string>) => string;

export function localizedModelIneligibility(
  model: Model,
  currentTier: PrivacyTier,
  translate: TranslateFn,
): string {
  if (model.isEligible) {
    return '';
  }

  if (model.ineligibilityReason === PRIVACY_TIER_REASON) {
    return translate('chat.models.unavailable.privacyTier', {
      current: translate('account.dataProcessing.tiers.' + currentTier + '.name'),
      required: translate(
        'account.dataProcessing.tiers.' + model.privacyTier + '.name',
      ),
    });
  }

  return translate('chat.models.unavailable.generic');
}
