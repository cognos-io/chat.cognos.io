import { describe, expect, it, vi } from 'vitest';

import { DocumentWorkerClient } from './document-worker.client';
import { DocImage, DocumentWorkerEvent, DocumentWorkerRequest } from './document.types';

// EventTarget-ish stand-in for the real Worker: captures postMessage calls and
// lets the test drive `message` events back at the client, without ever
// spinning up a real Web Worker (unavailable/awkward in the vitest/jsdom
// environment) or touching the real render pipeline.
class FakeWorker extends EventTarget {
  readonly postMessage = vi.fn();

  emit(data: DocumentWorkerEvent): void {
    this.dispatchEvent(new MessageEvent('message', { data }));
  }
}

function setup() {
  const fakeWorker = new FakeWorker();
  const client = new DocumentWorkerClient(() => fakeWorker as unknown as Worker);
  return { fakeWorker, client };
}

function lastRequest(fakeWorker: FakeWorker): DocumentWorkerRequest {
  const calls = fakeWorker.postMessage.mock.calls;
  return calls[calls.length - 1][0] as DocumentWorkerRequest;
}

describe('DocumentWorkerClient', () => {
  it('correlates two concurrent requests by requestId', async () => {
    const { fakeWorker, client } = setup();

    const first = client.render('docx', '# One', [], {});
    const firstId = lastRequest(fakeWorker).requestId;
    const second = client.render('pdf', '# Two', [], {});
    const secondId = lastRequest(fakeWorker).requestId;

    expect(firstId).not.toBe(secondId);

    // Resolve out of order — the second request finishes first.
    fakeWorker.emit({
      type: 'rendered',
      requestId: secondId,
      bytes: new Uint8Array([2]),
    });
    fakeWorker.emit({
      type: 'rendered',
      requestId: firstId,
      bytes: new Uint8Array([1]),
    });

    await expect(second).resolves.toEqual(new Uint8Array([2]));
    await expect(first).resolves.toEqual(new Uint8Array([1]));
  });

  it('rejects with a DocumentRenderError on a failed event', async () => {
    const { fakeWorker, client } = setup();

    const promise = client.render('docx', '# Title', [], {});
    const { requestId } = lastRequest(fakeWorker);
    fakeWorker.emit({
      type: 'failed',
      requestId,
      error: { code: 'render_failed', message: 'boom' },
    });

    await expect(promise).rejects.toMatchObject({
      name: 'DocumentRenderError',
      code: 'render_failed',
      message: 'boom',
    });
  });

  it('ignores an event for an unknown/already-settled requestId', async () => {
    const { fakeWorker, client } = setup();

    const promise = client.render('docx', '# Title', [], {});
    const { requestId } = lastRequest(fakeWorker);

    fakeWorker.emit({
      type: 'rendered',
      requestId: 'not-a-real-id',
      bytes: new Uint8Array([9]),
    });
    fakeWorker.emit({ type: 'rendered', requestId, bytes: new Uint8Array([1]) });

    await expect(promise).resolves.toEqual(new Uint8Array([1]));
  });

  it('passes image byte buffers as transferables', () => {
    const { fakeWorker, client } = setup();
    const images: DocImage[] = [
      { bytes: new Uint8Array([1, 2, 3]), mime: 'image/png' },
      { bytes: new Uint8Array([4, 5]), mime: 'image/png' },
    ];

    void client.render('docx', '# Title', images, {});

    const [request, transfer] = fakeWorker.postMessage.mock.calls[0];
    expect((request as DocumentWorkerRequest & { images: DocImage[] }).images).toBe(
      images,
    );
    expect(transfer).toEqual([images[0].bytes.buffer, images[1].bytes.buffer]);
  });

  it('creates the worker lazily, once, on the first render call', () => {
    const workerFactory = vi.fn(() => new FakeWorker() as unknown as Worker);
    const client = new DocumentWorkerClient(workerFactory);
    expect(workerFactory).not.toHaveBeenCalled();

    void client.render('docx', '# One', [], {});
    void client.render('pdf', '# Two', [], {});

    expect(workerFactory).toHaveBeenCalledTimes(1);
  });

  it('throws synchronously for format "xlsx" (routed through renderSheet instead)', () => {
    const { client } = setup();
    expect(() => client.render('xlsx', '{}', [], {})).toThrow(
      expect.objectContaining({ code: 'unsupported_format' }),
    );
  });
});

describe('DocumentWorkerClient.renderSheet', () => {
  it('posts a render-sheet request and resolves with bytes + warnings', async () => {
    const { fakeWorker, client } = setup();

    const promise = client.renderSheet('{"sheets":[]}', {});
    const request = lastRequest(fakeWorker) as DocumentWorkerRequest & {
      type: 'render-sheet';
    };
    expect(request.type).toBe('render-sheet');
    expect(request.body).toBe('{"sheets":[]}');

    fakeWorker.emit({
      type: 'rendered',
      requestId: request.requestId,
      bytes: new Uint8Array([1]),
      warnings: [{ sheet: 'S', cell: 'A1', kind: 'unknown_sheet', detail: 'x' }],
    });

    await expect(promise).resolves.toEqual({
      bytes: new Uint8Array([1]),
      warnings: [{ sheet: 'S', cell: 'A1', kind: 'unknown_sheet', detail: 'x' }],
    });
  });

  it('defaults warnings to an empty array when the event omits them', async () => {
    const { fakeWorker, client } = setup();

    const promise = client.renderSheet('{"sheets":[]}', {});
    const { requestId } = lastRequest(fakeWorker);
    fakeWorker.emit({ type: 'rendered', requestId, bytes: new Uint8Array([2]) });

    await expect(promise).resolves.toEqual({
      bytes: new Uint8Array([2]),
      warnings: [],
    });
  });

  it('rejects with a DocumentRenderError on a failed event', async () => {
    const { fakeWorker, client } = setup();

    const promise = client.renderSheet('{"sheets":[]}', {});
    const { requestId } = lastRequest(fakeWorker);
    fakeWorker.emit({
      type: 'failed',
      requestId,
      error: { code: 'render_failed', message: 'boom' },
    });

    await expect(promise).rejects.toMatchObject({
      name: 'DocumentRenderError',
      code: 'render_failed',
      message: 'boom',
    });
  });
});
