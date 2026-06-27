/// <reference lib="webworker" />
import { processAttachment } from '../attachment-pipeline';
import {
  AttachmentProcessingError,
  AttachmentWorkerErrorPayload,
  AttachmentWorkerEvent,
  AttachmentWorkerRequest,
} from '../attachment.types';

/**
 * Thin Web Worker wrapper around the framework-free attachment pipeline so file
 * sniffing, extraction and encryption never block the composer (spec §8). All
 * real logic lives in attachment-pipeline.ts, which is unit tested directly.
 */

const cancelled = new Set<string>();

const post = (event: AttachmentWorkerEvent, transfer?: Transferable[]): void => {
  // postMessage signature differs slightly across lib targets; cast keeps it
  // simple while still passing a transfer list.
  (self as unknown as Worker).postMessage(event, transfer ?? []);
};

const toErrorPayload = (err: unknown): AttachmentWorkerErrorPayload => {
  if (err instanceof AttachmentProcessingError) {
    return { code: err.code, message: err.message };
  }
  return { code: 'processing_failed', message: 'Attachment processing failed' };
};

const handleProcess = async (
  req: Extract<AttachmentWorkerRequest, { type: 'process' }>,
): Promise<void> => {
  const { requestId } = req;
  try {
    post({ type: 'progress', requestId, stage: 'processing' });

    const buffer = await req.file.arrayBuffer();
    if (cancelled.has(requestId)) {
      cancelled.delete(requestId);
      return;
    }

    post({ type: 'progress', requestId, stage: 'encrypting' });
    const result = await processAttachment({
      fileName: req.file.name,
      declaredMimeType: req.file.type,
      bytes: new Uint8Array(buffer),
      conversationId: req.conversationId,
      conversationPublicKey: req.conversationPublicKey,
      limits: req.limits,
      preferRawForPdf: req.preferRawForPdf,
    });

    if (cancelled.has(requestId)) {
      cancelled.delete(requestId);
      return;
    }

    post(
      { type: 'ready', requestId, result },
      result.artifacts.map((a) => a.ciphertext.buffer),
    );
  } catch (err) {
    post({ type: 'failed', requestId, error: toErrorPayload(err) });
  }
};

addEventListener('message', (event: MessageEvent<AttachmentWorkerRequest>) => {
  const req = event.data;
  if (req.type === 'cancel') {
    cancelled.add(req.requestId);
    return;
  }
  void handleProcess(req);
});
