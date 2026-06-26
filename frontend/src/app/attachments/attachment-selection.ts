import { AttachmentRecord } from './attachment-upload.service';
import {
  AttachmentProcessingErrorCode,
  AttachmentProcessingStage,
  EncryptedAttachmentDraft,
} from './attachment.types';

/**
 * SelectedAttachment is the composer-side view of one chosen file as it moves
 * through process → encrypt → upload → ready.
 */
export interface SelectedAttachment {
  localId: string;
  requestId: string;
  conversationId: string;
  fileName: string;
  sizeBytes: number;
  mimeType: string;
  processorId: string;
  state: AttachmentProcessingStage;
  errorCode?: AttachmentProcessingErrorCode;
  draft?: EncryptedAttachmentDraft;
  record?: AttachmentRecord;
  textContext?: string;
  contextTruncated?: boolean;
}

export interface CompletionAttachmentContext {
  attachmentId: string;
  displayName: string;
  detectedMimeType: string;
  processorId: string;
  textContext?: string;
  contextTruncated?: boolean;
}

export interface AttachmentCompletionPayload {
  attachmentIds: string[];
  attachmentContexts: CompletionAttachmentContext[];
}

const isReady = (attachment: SelectedAttachment): boolean =>
  attachment.state === 'ready' && !!attachment.record;

/**
 * buildCompletionAttachmentInputs maps ready attachments to the completion
 * request fields: the persisted ids and the transient provider context. Only
 * attachments with text context contribute a context entry.
 */
export const buildCompletionAttachmentInputs = (
  selected: readonly SelectedAttachment[],
): AttachmentCompletionPayload => {
  const ready = selected.filter(isReady);
  return {
    attachmentIds: ready.map((attachment) => attachment.record!.id),
    attachmentContexts: ready
      .filter((attachment) => (attachment.textContext ?? '').trim().length > 0)
      .map((attachment) => ({
        attachmentId: attachment.record!.id,
        displayName: attachment.fileName,
        detectedMimeType: attachment.mimeType,
        processorId: attachment.processorId,
        textContext: attachment.textContext,
        contextTruncated: attachment.contextTruncated,
      })),
  };
};

/** True when there is at least one attachment still not in a terminal state. */
export const hasPendingAttachments = (
  selected: readonly SelectedAttachment[],
): boolean => selected.some((a) => a.state !== 'ready' && a.state !== 'failed');
