import { TestBed } from '@angular/core/testing';

import {
  ConversationImportClient,
  IMPORT_WORKER_FACTORY,
} from './conversation-import-client';

describe('ConversationImportClient', () => {
  let service: ConversationImportClient;
  let worker: FakeWorker;

  beforeEach(() => {
    worker = new FakeWorker();
    TestBed.configureTestingModule({
      providers: [{ provide: IMPORT_WORKER_FACTORY, useValue: () => worker }],
    });
    service = TestBed.inject(ConversationImportClient);
  });

  it('transfers the export buffer instead of cloning it', () => {
    const buffer = new ArrayBuffer(32);

    void service.parse('claude', buffer);

    expect(worker.transfer).toEqual([buffer]);
    expect(worker.message).toMatchObject({ type: 'parse', source: 'claude' });
  });

  it('terminates the worker and rejects pending parsing on cancel', async () => {
    const pending = service.parse('chatgpt', new ArrayBuffer(1));

    service.cancel();

    await expect(pending).rejects.toThrow('cancelled');
    expect(worker.terminated).toBe(true);
  });
});

class FakeWorker {
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  message: unknown;
  transfer: Transferable[] = [];
  terminated = false;

  postMessage(message: unknown, transfer: Transferable[]): void {
    this.message = message;
    this.transfer = transfer;
  }

  terminate(): void {
    this.terminated = true;
  }
}
