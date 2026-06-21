import { TranslocoService } from '@jsverse/transloco';

import type {
  CognosRedactedTextKind,
  CognosRedactedTextLabels,
} from '@cognos/ui-angular';

import { RedactionType } from '@app/redaction';

// Shared mapping + copy for the cog-redacted-text pill, so the composer preview
// and the in-message renderer present redactions identically and localised.

// Detector type → the pill's visual kind. Types without a dedicated icon fall
// back to a labelled "custom" pill.
export function redactionKindFor(type: RedactionType): CognosRedactedTextKind {
  switch (type) {
    case 'email':
      return 'email';
    case 'phone':
      return 'phone';
    case 'person':
      return 'name';
    default:
      return 'custom';
  }
}

// Localised label for a detector type, used as the pill's badge text.
export function redactionTypeLabel(
  transloco: TranslocoService,
  type: RedactionType,
): string {
  return transloco.translate(`chat.composer.redaction.types.${type}`);
}

// Localised copy for the explainer modal (the library ships English defaults).
export function redactionModalLabels(
  transloco: TranslocoService,
): CognosRedactedTextLabels {
  return {
    title: transloco.translate('chat.redaction.modal.title'),
    detected: transloco.translate('chat.redaction.modal.detected'),
    explainer: transloco.translate('chat.redaction.modal.explainer'),
    youSee: transloco.translate('chat.redaction.modal.youSee'),
    modelSees: transloco.translate('chat.redaction.modal.modelSees'),
    notice: transloco.translate('chat.redaction.modal.notice'),
    copy: transloco.translate('chat.redaction.modal.copy'),
    settings: transloco.translate('chat.redaction.modal.settings'),
    done: transloco.translate('chat.redaction.modal.done'),
  };
}
