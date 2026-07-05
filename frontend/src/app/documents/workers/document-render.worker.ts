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
import { validateSheetSpec } from '../sheets/formula-validator';
import { renderSheet } from '../sheets/sheet-renderer';
import { parseSheetSpec } from '../sheets/sheet-spec.types';

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

// A cap breach (too many sheets/rows/cells, an over-length formula) is a
// distinct, translatable failure from "the JSON didn't parse" or "a field
// was the wrong shape" — reported as 'source_too_large' so the card can show
// a more specific message than the generic render_failed one.
const isCapError = (errors: string[]): boolean =>
  errors.some((error) => error.includes('too_many') || error.includes('too_large'));

const handleRenderSheet = async (
  req: Extract<DocumentWorkerRequest, { type: 'render-sheet' }>,
): Promise<void> => {
  const { requestId } = req;
  try {
    const { spec, errors } = parseSheetSpec(req.body);
    if (!spec) {
      throw new DocumentRenderError(
        isCapError(errors) ? 'source_too_large' : 'render_failed',
        errors.join('; ') || 'Invalid sheet spec',
      );
    }

    if (cancelled.has(requestId)) {
      cancelled.delete(requestId);
      return;
    }

    const { spec: validated, warnings } = validateSheetSpec(spec);

    if (cancelled.has(requestId)) {
      cancelled.delete(requestId);
      return;
    }

    const bytes = await renderSheet(validated, req.options);

    if (cancelled.has(requestId)) {
      cancelled.delete(requestId);
      return;
    }

    post({ type: 'rendered', requestId, bytes, warnings }, [bytes.buffer]);
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
  if (req.type === 'render-sheet') {
    void handleRenderSheet(req);
    return;
  }
  void handleRender(req);
});
