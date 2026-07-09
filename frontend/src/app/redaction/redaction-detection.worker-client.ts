import type {
  RedactionWorkerRequest,
  RedactionWorkerResponse,
} from './redaction-detection.worker';
import { RedactionCandidate } from './redaction-types';

export class RedactionDetectionWorkerClient {
  private worker: Worker | null = null;
  private readonly pending = new Map<
    string,
    { resolve: (candidates: RedactionCandidate[]) => void; reject: () => void }
  >();

  detect(
    request: Omit<RedactionWorkerRequest, 'requestId'>,
  ): Promise<RedactionCandidate[]> {
    const worker = this.ensureWorker();
    if (!worker) {
      return Promise.reject();
    }
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      this.pending.set(requestId, { resolve, reject });
      worker.postMessage({ ...request, requestId });
    });
  }

  private ensureWorker(): Worker | null {
    if (typeof Worker === 'undefined') {
      return null;
    }
    if (this.worker) {
      return this.worker;
    }
    try {
      this.worker = new Worker(
        new URL('./redaction-detection.worker', import.meta.url),
        {
          type: 'module',
        },
      );
      this.worker.onmessage = (event: MessageEvent<RedactionWorkerResponse>) => {
        const pending = this.pending.get(event.data.requestId);
        if (!pending) return;
        this.pending.delete(event.data.requestId);
        if (event.data.type === 'result') {
          pending.resolve(event.data.candidates);
        } else {
          pending.reject();
        }
      };
      this.worker.onerror = () => {
        for (const pending of this.pending.values()) {
          pending.reject();
        }
        this.pending.clear();
        this.worker?.terminate();
        this.worker = null;
      };
      return this.worker;
    } catch {
      return null;
    }
  }
}
