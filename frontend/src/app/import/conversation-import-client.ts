import { Injectable, InjectionToken, inject } from '@angular/core';

import { ImportPreview, ImportSource } from './import-types';

export const IMPORT_WORKER_FACTORY = new InjectionToken<() => Worker>(
  'IMPORT_WORKER_FACTORY',
  {
    providedIn: 'root',
    factory: () => () =>
      new Worker(new URL('./conversation-import.worker', import.meta.url), {
        type: 'module',
      }),
  },
);

@Injectable({
  providedIn: 'root',
})
export class ConversationImportClient {
  private readonly _workerFactory = inject(IMPORT_WORKER_FACTORY);
  private _worker: Worker | null = null;
  private _reject: ((reason: Error) => void) | null = null;

  parse(
    source: ImportSource,
    buffer: ArrayBuffer,
    onProgress?: (stage: 'validated' | 'parsed') => void,
  ): Promise<ImportPreview> {
    this.cancel();
    const worker = this._workerFactory();
    this._worker = worker;
    const requestId = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      this._reject = reject;
      worker.onmessage = ({ data }) => {
        if (data?.requestId !== requestId) return;
        if (data.type === 'progress') {
          onProgress?.(data.stage);
          return;
        }
        worker.terminate();
        if (this._worker === worker) this._worker = null;
        this._reject = null;
        if (data.type === 'preview') resolve(data.preview as ImportPreview);
        else
          reject(
            new Error(
              typeof data.reason === 'string' ? data.reason : 'unsupported_schema',
            ),
          );
      };
      worker.onerror = () => {
        worker.terminate();
        if (this._worker === worker) this._worker = null;
        this._reject = null;
        reject(new Error('unsupported_schema'));
      };
      worker.postMessage({ type: 'parse', requestId, source, buffer }, [buffer]);
    });
  }

  cancel(): void {
    this._worker?.terminate();
    this._worker = null;
    this._reject?.(new Error('cancelled'));
    this._reject = null;
  }
}
