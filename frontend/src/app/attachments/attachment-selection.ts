import { RedactionEntry } from '@app/redaction';

import { AttachmentRecord } from './attachment-upload.service';
import {
  AttachmentProcessingErrorCode,
  AttachmentProcessingStage,
  EncryptedAttachmentDraft,
  FileAiContext,
  ImageAiContext,
} from './attachment.types';

/**
 * SelectedAttachment is the composer-side view of one chosen file as it moves
 * through process → encrypt → upload → ready.
 */
export interface SelectedAttachment {
  localId: string;
  requestId: string;
  /** Legacy/unused for library files (they are user-scoped, not conversation-scoped). */
  conversationId?: string;
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
  fileContext?: FileAiContext;
  /** True when this attachment is an image (gated to vision-capable models). */
  isImage?: boolean;
  /** True when this attachment is a raw file (gated to file-capable models). */
  isRawFile?: boolean;
  /**
   * Redaction mappings minted over the extracted text (when redaction is on).
   * Persisted to the conversation's redaction scope on send so the tokens in the
   * (already-redacted) textContext hydrate. Never sent to the provider.
   */
  redactionEntries?: RedactionEntry[];
}

/**
 * A library file chosen via the picker, already uploaded, ready to attach to the
 * current message without re-processing. The provider context (textContext /
 * imageContext / fileContext) is materialised by decrypting the file's artifacts
 * before it is injected, so a reused file still contributes context + redaction.
 */
export interface LibrarySelection {
  record: AttachmentRecord;
  fileName: string;
  sizeBytes: number;
  mimeType: string;
  processorId?: string;
  textContext?: string;
  contextTruncated?: boolean;
  imageContext?: ImageAiContext;
  fileContext?: FileAiContext;
  redactionEntries?: RedactionEntry[];
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
  fileBase64?: string;
  fileName?: string;
  fileMimeType?: string;
}

export interface AttachmentCompletionPayload {
  attachmentIds: string[];
  attachmentContexts: CompletionAttachmentContext[];
  /**
   * Aggregated redaction mappings across the ready attachments, deduped by token.
   * Persisted to the conversation's redaction scope on send (never sent to the
   * provider — the wire contexts carry only the already-redacted text).
   */
  redactionEntries: RedactionEntry[];
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
  const redactionByToken = new Map<string, RedactionEntry>();
  for (const attachment of ready) {
    for (const entry of attachment.redactionEntries ?? []) {
      redactionByToken.set(entry.token, entry);
    }
  }
  return {
    redactionEntries: [...redactionByToken.values()],
    attachmentIds: ready.map((attachment) => attachment.record!.id),
    attachmentContexts: ready
      .filter(
        (attachment) =>
          (attachment.textContext ?? '').trim().length > 0 ||
          !!attachment.imageContext ||
          !!attachment.fileContext,
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
        fileBase64: attachment.fileContext?.base64,
        fileName: attachment.fileContext?.fileName,
        fileMimeType: attachment.fileContext?.mimeType,
      })),
  };
};

/** True when there is at least one attachment still not in a terminal state. */
export const hasPendingAttachments = (
  selected: readonly SelectedAttachment[],
): boolean => selected.some((a) => a.state !== 'ready' && a.state !== 'failed');

/** A user-upload attachment referenced by a message in the conversation path. */
export interface PathAttachmentRef {
  attachmentId: string;
  messageId?: string;
}

/**
 * Collect the user-upload attachment references carried by messages in the active
 * path, so a follow-up turn can re-send their context (a stateless model forgets
 * an attachment otherwise). Deduped by attachment id, and `excludeIds` (the
 * current composer selection) are skipped so they aren't sent twice.
 */
export const collectPathAttachmentRefs = (
  messages: readonly {
    record_id?: string;
    decryptedData?: { attachments?: { kind?: string; attachment_id?: string }[] };
  }[],
  excludeIds: ReadonlySet<string> = new Set(),
  excludeMessageIds: ReadonlySet<string> = new Set(),
): PathAttachmentRef[] => {
  const seen = new Set<string>(excludeIds);
  const refs: PathAttachmentRef[] = [];
  for (const message of messages) {
    // Messages folded into a compaction summary are dropped from the raw context,
    // so re-sending their attachment would be wasted cost — skip them.
    if (message.record_id && excludeMessageIds.has(message.record_id)) {
      continue;
    }
    for (const attachment of message.decryptedData?.attachments ?? []) {
      const id = attachment.attachment_id;
      if (attachment.kind !== 'user_upload' || !id || seen.has(id)) {
        continue;
      }
      seen.add(id);
      refs.push({ attachmentId: id, messageId: message.record_id });
    }
  }
  return refs;
};
