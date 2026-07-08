import type { SecurityModalContent } from '@cognos/ui-angular';

import { RegionInput, regionBadgeKey, regionFlag } from './region';
import { ServedModelInfo } from './served-model';

export type TranslateFn = (key: string, params?: Record<string, unknown>) => string;

// Localised "Switzerland | EU | Global" gateway label for a served region.
export const gatewayLabel = (region: RegionInput, t: TranslateFn): string =>
  t('chat.privacy.gateway.' + regionBadgeKey(region));

// Localised auto-delete value: "Off" when never (0 effective days), else the
// "{{count}} days" form. Takes the EFFECTIVE retention (see effectiveRetentionDays).
export const autoDeleteValue = (effectiveDays: number, t: TranslateFn): string =>
  effectiveDays <= 0
    ? t('chat.privacy.autoDelete.off')
    : t('chat.privacy.autoDelete.days', { count: effectiveDays });

// The one compact line rendered under each assistant answer. Kept as a single
// interpolated string so translators control word order in each locale.
export const privacyReceiptLine = (
  served: ServedModelInfo,
  effectiveDays: number,
  t: TranslateFn,
): string =>
  t('chat.privacy.receipt', {
    model: served.modelName,
    region: gatewayLabel(served.region, t),
    retention: autoDeleteValue(effectiveDays, t),
  });

export interface PrivacyPanelContentInputs {
  served: ServedModelInfo;
  effectiveRetentionDays: number;
  securityUrl: string;
  subprocessorsUrl: string;
  t: TranslateFn;
}

// buildPrivacyPanelContent assembles the fully-translated, conversation-specific
// content the presentational `cog-security-modal` renders. Keeping it here (pure,
// input-driven) means the library component stays i18n-agnostic and this is unit
// testable, while the region step and detail rows reflect the ACTUAL served
// region instead of the old hardcoded "Swiss compute".
export const buildPrivacyPanelContent = ({
  served,
  effectiveRetentionDays,
  securityUrl,
  subprocessorsUrl,
  t,
}: PrivacyPanelContentInputs): SecurityModalContent => {
  const tier = regionBadgeKey(served.region);
  const modelValue = served.providerName
    ? `${served.modelName} · ${served.providerName}`
    : served.modelName;

  return {
    title: t('chat.privacy.title'),
    items: [
      {
        icon: 'lock',
        title: t('chat.privacy.items.stored.title'),
        copy: t('chat.privacy.items.stored.copy'),
      },
      {
        icon: 'eye-off',
        title: t('chat.privacy.items.readable.title'),
        copy: t('chat.privacy.items.readable.copy'),
      },
      {
        icon: 'graduation-cap',
        title: t('chat.privacy.items.training.title'),
        copy: t('chat.privacy.items.training.copy'),
      },
      {
        icon: 'search',
        title: t('chat.privacy.items.search.title'),
        copy: t('chat.privacy.items.search.copy'),
      },
    ],
    caveatTitle: t('chat.privacy.caveat.title'),
    caveatCopy: t('chat.privacy.caveat.copy'),
    flowDeviceTitle: t('chat.privacy.flow.device'),
    flowEncryptedSub: t('chat.privacy.flow.encrypted'),
    flowReencryptedSub: t('chat.privacy.flow.reencrypted'),
    computeFlag: regionFlag(served.region),
    computeTitle: t('chat.privacy.gateway.' + tier),
    computeSub: t('chat.privacy.flow.compute'),
    rows: [
      {
        icon: 'sparkles',
        label: t('chat.privacy.rows.model'),
        value: modelValue,
      },
      {
        icon: 'server',
        label: t('chat.privacy.rows.region'),
        value: t('account.dataProcessing.tiers.' + tier + '.name'),
      },
      {
        icon: 'eraser',
        label: t('chat.privacy.rows.autoDelete'),
        value: autoDeleteValue(effectiveRetentionDays, t),
      },
    ],
    keysLabel: t('chat.privacy.keysLabel'),
    deviceKeyLabel: t('chat.privacy.deviceKey'),
    verifiedLabel: t('chat.privacy.verified'),
    links: [
      { label: t('chat.privacy.links.security'), href: securityUrl },
      { label: t('chat.privacy.links.subprocessors'), href: subprocessorsUrl },
    ],
    closeLabel: t('common.close'),
  };
};
