// Framework-free client for the document render worker (spec
// docs/specs/document-generation.md §7). No Angular imports — DocumentExportService
// constructs (or is given a fake of) this directly rather than injecting it,
// so the heavy render pipeline stays fully testable without a real Worker.
import {
  DocFormat,
  DocImage,
  DocumentRenderError,
  DocumentWorkerEvent,
  DocumentWorkerRequest,
  RenderOptions,
} from './document.types';
import { SheetWarning } from './sheets/formula-validator';

export type DocumentWorkerFactory = () => Worker;

const defaultWorkerFactory: DocumentWorkerFactory = () =>
  new Worker(new URL('./workers/document-render.worker', import.meta.url), {
    type: 'module',
  });

interface RenderedPayload {
  bytes: Uint8Array;
  warnings?: SheetWarning[];
}

interface PendingRequest {
  resolve: (event: RenderedPayload) => void;
  reject: (err: DocumentRenderError) => void;
}

let localIdCounter = 0;
const nextRequestId = (): string => `doc-render-${Date.now()}-${(localIdCounter += 1)}`;

/**
 * DocumentWorkerClient owns the document-render Web Worker (created lazily, on
 * first render) and correlates concurrent render requests by id. The worker
 * factory is injectable so specs can substitute a fake Worker without ever
 * spinning up a real one.
 */
export class DocumentWorkerClient {
  private worker: Worker | null = null;
  private readonly pending = new Map<string, PendingRequest>();

  constructor(
    private readonly workerFactory: DocumentWorkerFactory = defaultWorkerFactory,
  ) {}

  render(
    format: Exclude<DocFormat, 'markdown'>,
    markdown: string,
    images: DocImage[],
    options: RenderOptions,
  ): Promise<Uint8Array> {
    if (format === 'xlsx') {
      // xlsx documents are sheet-spec JSON, not markdown, and have no
      // DocIR/images to carry — always routed through renderSheet()
      // instead, which also surfaces validator warnings. This parameter's
      // type widens to include 'xlsx' automatically now that DocFormat
      // does (kept in sync with the CogDocSpec format union rather than
      // duplicated), but no caller actually reaches this branch: a
      // CogDocBlock's spec.format is 'docx' | 'pdf' only.
      throw new DocumentRenderError(
        'unsupported_format',
        'Use renderSheet() for xlsx documents',
      );
    }

    const requestId = nextRequestId();
    const request: DocumentWorkerRequest = {
      type: 'render',
      requestId,
      format,
      markdown,
      images,
      options,
    };
    // Image bytes transfer to the worker rather than being copied — nothing
    // on the main thread needs them again once handed off to render.
    const transfer = images.map((image) => image.bytes.buffer);

    return new Promise<Uint8Array>((resolve, reject) => {
      this.pending.set(requestId, {
        resolve: (event) => resolve(event.bytes),
        reject,
      });
      this.ensureWorker().postMessage(request, transfer);
    });
  }

  /**
   * renderSheet renders a `<cog-doc format="xlsx">` sheet-spec body (spec
   * docs/specs/document-generation.md §5.3). Unlike render(), it also
   * surfaces the formula validator's advisory warnings — the caller decides
   * whether/how to show them on the document card.
   */
  renderSheet(
    body: string,
    options: RenderOptions,
  ): Promise<{ bytes: Uint8Array; warnings: SheetWarning[] }> {
    const requestId = nextRequestId();
    const request: DocumentWorkerRequest = {
      type: 'render-sheet',
      requestId,
      body,
      options,
    };

    return new Promise((resolve, reject) => {
      this.pending.set(requestId, {
        resolve: (event) =>
          resolve({ bytes: event.bytes, warnings: event.warnings ?? [] }),
        reject,
      });
      this.ensureWorker().postMessage(request);
    });
  }

  private ensureWorker(): Worker {
    if (!this.worker) {
      this.worker = this.workerFactory();
      this.worker.addEventListener(
        'message',
        (event: MessageEvent<DocumentWorkerEvent>) => this.onWorkerEvent(event.data),
      );
    }
    return this.worker;
  }

  private onWorkerEvent(event: DocumentWorkerEvent): void {
    const pending = this.pending.get(event.requestId);
    if (!pending) {
      return; // stale/unknown request (e.g. already settled)
    }
    this.pending.delete(event.requestId);

    if (event.type === 'rendered') {
      pending.resolve({ bytes: event.bytes, warnings: event.warnings });
    } else {
      pending.reject(new DocumentRenderError(event.error.code, event.error.message));
    }
  }
}
