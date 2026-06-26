import { Injectable, computed, inject, signal } from '@angular/core';

import {
  AttachmentCompletionPayload,
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
    conversationId: string,
    conversationPublicKey: Uint8Array,
  ): number {
    const remaining =
      USER_ATTACHMENT_MAX_COUNT_PER_MESSAGE - this._attachments().length;
    const accepted = files.slice(0, Math.max(0, remaining));

    for (const file of accepted) {
      const requestId = nextLocalId();
      const selection: SelectedAttachment = {
        localId: requestId,
        requestId,
        conversationId,
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
        conversationId,
        conversationPublicKey,
        limits: defaultAttachmentLimits(),
      };
      this.ensureWorker().postMessage(request);
    }

    return accepted.length;
  }

  /** Remove a selected attachment, cancelling processing and deleting any draft. */
  remove(localId: string): void {
    const target = this._attachments().find((a) => a.localId === localId);
    if (!target) {
      return;
    }
    this.worker?.postMessage({
      type: 'cancel',
      requestId: target.requestId,
    } as AttachmentWorkerRequest);
    if (target.record) {
      this._upload.deleteDraft(target.conversationId, target.record.id).subscribe({
        error: () => {
          /* best-effort: the draft cleanup job will reap it */
        },
      });
    }
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
    });

    this._upload.upload(target.conversationId, draft).subscribe({
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
