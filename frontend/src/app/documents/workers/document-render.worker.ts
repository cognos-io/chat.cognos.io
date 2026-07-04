/// <reference lib="webworker" />
import {
  DocumentRenderError,
  DocumentWorkerErrorPayload,
  DocumentWorkerEvent,
  DocumentWorkerRequest,
} from '../document.types';
import { markdownToDocIR } from '../markdown/markdown-to-docir';
import { renderDocx } from '../renderers/docx-renderer';
import { renderPdf } from '../renderers/pdf-renderer';

/**
 * Thin Web Worker wrapper around the framework-free render pipeline so the
 * heavy docx/pdfmake libraries and the actual rendering work never touch the
 * UI thread (spec docs/specs/document-generation.md §7). Mirrors the
 * attachment worker exactly (attachments/workers/attachment-processing.worker.ts):
 * all real logic lives in unit-tested modules; this file only wires messages.
 */

const cancelled = new Set<string>();

const post = (event: DocumentWorkerEvent, transfer?: Transferable[]): void => {
  (self as unknown as Worker).postMessage(event, transfer ?? []);
};

const toErrorPayload = (err: unknown): DocumentWorkerErrorPayload => {
  if (err instanceof DocumentRenderError) {
    return { code: err.code, message: err.message };
  }
  return { code: 'render_failed', message: 'Document render failed' };
};

const handleRender = async (
  req: Extract<DocumentWorkerRequest, { type: 'render' }>,
): Promise<void> => {
  const { requestId } = req;
  try {
    const doc = markdownToDocIR(req.markdown);
    // Message images join the document as trailing blocks — this is where
    // generated images ride along at the end of the model's text (spec §7).
    req.images.forEach((_, index) => {
      doc.blocks.push({ type: 'image', imageRef: index });
    });

    if (cancelled.has(requestId)) {
      cancelled.delete(requestId);
      return;
    }

    const render = req.format === 'docx' ? renderDocx : renderPdf;
    const bytes = await render(doc, req.images, req.options);

    if (cancelled.has(requestId)) {
      cancelled.delete(requestId);
      return;
    }

    post({ type: 'rendered', requestId, bytes }, [bytes.buffer]);
  } catch (err) {
    post({ type: 'failed', requestId, error: toErrorPayload(err) });
  }
};

addEventListener('message', (event: MessageEvent<DocumentWorkerRequest>) => {
  const req = event.data;
  if (req.type === 'cancel') {
    cancelled.add(req.requestId);
    return;
  }
  void handleRender(req);
});
