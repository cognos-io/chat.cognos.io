import { Injectable, computed, inject, signal } from '@angular/core';

import {
  AttachmentCompletionPayload,
  LibrarySelection,
  SelectedAttachment,
  buildCompletionAttachmentInputs,
  hasPendingAttachments,
} from './attachment-selection';
import { AttachmentUploadService } from './attachment-upload.service';
import {
  AttachmentProcessingStage,
  AttachmentWorkerEvent,
  AttachmentWorkerRequest,
  EncryptedAttachmentDraft,
  USER_ATTACHMENT_MAX_COUNT_PER_MESSAGE,
  defaultAttachmentLimits,
} from './attachment.types';

let localIdCounter = 0;
const nextLocalId = (): string => `att-${Date.now()}-${(localIdCounter += 1)}`;

/**
 * AttachmentProcessingService owns the attachment Web Worker and the composer's
 * selection state. It drives each file through process → encrypt (worker) →
 * upload (draft) → ready, exposing signals the composer renders. All heavy work
 * is off the UI thread; the service only orchestrates.
 */
@Injectable({ providedIn: 'root' })
export class AttachmentProcessingService {
  private readonly _upload = inject(AttachmentUploadService);

  private worker: Worker | null = null;
  private readonly _attachments = signal<SelectedAttachment[]>([]);

  readonly attachments = this._attachments.asReadonly();
  readonly hasPending = computed(() => hasPendingAttachments(this._attachments()));
  readonly count = computed(() => this._attachments().length);
  readonly canAddMore = computed(
    () => this._attachments().length < USER_ATTACHMENT_MAX_COUNT_PER_MESSAGE,
  );

  /**
   * add queues files for processing. Returns the number actually accepted (the
   * per-message cap may reject extras). The caller surfaces the cap to the user.
   */
  add(
    files: File[],
    ownerPublicKey: Uint8Array,
    preferRawForPdf = false,
    redact = false,
  ): number {
    const remaining =
      USER_ATTACHMENT_MAX_COUNT_PER_MESSAGE - this._attachments().length;
    const accepted = files.slice(0, Math.max(0, remaining));

    for (const file of accepted) {
      const requestId = nextLocalId();
      const selection: SelectedAttachment = {
        localId: requestId,
        requestId,
        fileName: file.name,
        sizeBytes: file.size,
        mimeType: file.type || 'application/octet-stream',
        processorId: 'text',
        state: 'queued',
      };
      this._attachments.update((list) => [...list, selection]);

      const request: AttachmentWorkerRequest = {
        type: 'process',
        requestId,
        file,
        ownerPublicKey,
        limits: defaultAttachmentLimits(),
        preferRawForPdf,
        redact,
      };
      this.ensureWorker().postMessage(request);
    }

    return accepted.length;
  }

  /**
   * addFromLibrary injects already-uploaded library files into the composer
   * selection as ready attachments (no re-processing or re-upload). The provider
   * context is materialised separately by the caller (it must decrypt the file's
   * extracted text), so these start without textContext.
   */
  addFromLibrary(files: readonly LibrarySelection[]): number {
    const remaining =
      USER_ATTACHMENT_MAX_COUNT_PER_MESSAGE - this._attachments().length;
    const accepted = files.slice(0, Math.max(0, remaining));

    for (const file of accepted) {
      const requestId = nextLocalId();
      const selection: SelectedAttachment = {
        localId: requestId,
        requestId,
        fileName: file.fileName,
        sizeBytes: file.sizeBytes,
        mimeType: file.mimeType,
        processorId: file.processorId ?? 'library',
        state: 'ready',
        record: file.record,
        textContext: file.textContext,
        contextTruncated: file.contextTruncated,
        imageContext: file.imageContext,
        isImage: !!file.imageContext,
        fileContext: file.fileContext,
        isRawFile: !!file.fileContext,
        // Carry the file's redaction mappings so they're merged into the
        // conversation on send and the placeholders hydrate (regression: a
        // reused/deduped file otherwise shows raw [[PII_…]] tokens).
        redactionEntries: file.redactionEntries,
      };
      this._attachments.update((list) => [...list, selection]);
    }
    return accepted.length;
  }

  /**
   * Remove a selected attachment from the composer. Processing (if still running)
   * is cancelled, but an uploaded file is NOT deleted — uploading adds it to the
   * user's library, where it persists until they delete it from the library view.
   */
  remove(localId: string): void {
    const target = this._attachments().find((a) => a.localId === localId);
    if (!target) {
      return;
    }
    this.worker?.postMessage({
      type: 'cancel',
      requestId: target.requestId,
    } as AttachmentWorkerRequest);
    this._attachments.update((list) => list.filter((a) => a.localId !== localId));
  }

  /** Clear the selection after a successful send (drafts are now message-linked). */
  clear(): void {
    this._attachments.set([]);
  }

  /** Map ready attachments to the completion request fields. */
  completionInputs(): AttachmentCompletionPayload {
    return buildCompletionAttachmentInputs(this._attachments());
  }

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(
        new URL('./workers/attachment-processing.worker', import.meta.url),
        { type: 'module' },
      );
      this.worker.addEventListener(
        'message',
        (event: MessageEvent<AttachmentWorkerEvent>) => this.onWorkerEvent(event.data),
      );
    }
    return this.worker;
  }

  private onWorkerEvent(event: AttachmentWorkerEvent): void {
    switch (event.type) {
      case 'progress':
        this.patch(event.requestId, { state: event.stage });
        break;
      case 'ready':
        this.onDraftReady(event.requestId, event.result);
        break;
      case 'failed':
        this.patch(event.requestId, { state: 'failed', errorCode: event.error.code });
        break;
    }
  }

  private onDraftReady(requestId: string, draft: EncryptedAttachmentDraft): void {
    const target = this._attachments().find((a) => a.requestId === requestId);
    if (!target) {
      return; // removed mid-flight
    }
    this.patch(requestId, {
      state: 'uploading',
      draft,
      textContext: draft.ai.textContext,
      contextTruncated: draft.ai.contextTruncated,
      imageContext: draft.ai.imageContext,
      isImage: !!draft.ai.imageContext,
      fileContext: draft.ai.fileContext,
      isRawFile: !!draft.ai.fileContext,
      redactionEntries: draft.ai.redactionEntries,
    });

    this._upload.upload(draft).subscribe({
      next: (record) => this.patch(requestId, { state: 'ready', record }),
      error: () =>
        this.patch(requestId, { state: 'failed', errorCode: 'processing_failed' }),
    });
  }

  private patch(requestId: string, change: Partial<SelectedAttachment>): void {
    this._attachments.update((list) =>
      list.map((a) => (a.requestId === requestId ? { ...a, ...change } : a)),
    );
  }
}

export type { AttachmentProcessingStage };
