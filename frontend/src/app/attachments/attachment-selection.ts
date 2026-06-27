import { AttachmentRecord } from './attachment-upload.service';
import {
  AttachmentProcessingErrorCode,
  AttachmentProcessingStage,
  EncryptedAttachmentDraft,
  ImageAiContext,
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
  imageContext?: ImageAiContext;
  /** True when this attachment is an image (gated to vision-capable models). */
  isImage?: boolean;
}

export interface CompletionAttachmentContext {
  attachmentId: string;
  displayName: string;
  detectedMimeType: string;
  processorId: string;
  textContext?: string;
  contextTruncated?: boolean;
  imageBase64?: string;
  imageMimeType?: string;
}

export interface AttachmentCompletionPayload {
  attachmentIds: string[];
  attachmentContexts: CompletionAttachmentContext[];
}

const isReady = (attachment: SelectedAttachment): boolean =>
  attachment.state === 'ready' && !!attachment.record;

/**
 * buildCompletionAttachmentInputs maps ready attachments to the completion
 * request fields: the persisted ids and the transient provider context. An
 * attachment contributes a context entry when it has extracted text or a
 * model-ready image.
 */
export const buildCompletionAttachmentInputs = (
  selected: readonly SelectedAttachment[],
): AttachmentCompletionPayload => {
  const ready = selected.filter(isReady);
  return {
    attachmentIds: ready.map((attachment) => attachment.record!.id),
    attachmentContexts: ready
      .filter(
        (attachment) =>
          (attachment.textContext ?? '').trim().length > 0 || !!attachment.imageContext,
      )
      .map((attachment) => ({
        attachmentId: attachment.record!.id,
        displayName: attachment.fileName,
        detectedMimeType: attachment.mimeType,
        processorId: attachment.processorId,
        textContext: attachment.textContext,
        contextTruncated: attachment.contextTruncated,
        imageBase64: attachment.imageContext?.base64,
        imageMimeType: attachment.imageContext?.mimeType,
      })),
  };
};

/** True when there is at least one attachment still not in a terminal state. */
export const hasPendingAttachments = (
  selected: readonly SelectedAttachment[],
): boolean => selected.some((a) => a.state !== 'ready' && a.state !== 'failed');
