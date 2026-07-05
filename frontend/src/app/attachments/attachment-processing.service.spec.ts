import { TestBed } from '@angular/core/testing';

import { of, throwError } from 'rxjs';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RedactionEntry } from '@app/redaction';

import { AttachmentProcessingService } from './attachment-processing.service';
import { LibrarySelection } from './attachment-selection';
import { AttachmentRecord, AttachmentUploadService } from './attachment-upload.service';
import { EncryptedAttachmentDraft } from './attachment.types';

const record = (id: string): AttachmentRecord => ({
  id,
  sizeBytes: 12,
  files: ['art-0.enc', 'art-1.enc'],
  data: 'c2VhbGVk',
  created: 'now',
  updated: 'now',
});

const ibanEntry: RedactionEntry = {
  version: '1',
  token: '[[PII_IBAN_6JPRFO]]',
  type: 'iban',
  original: 'DE75512108001245126199',
  normalized: 'DE75512108001245126199',
  detector: 'iban:v1',
};

describe('AttachmentProcessingService.addFromLibrary', () => {
  let service: AttachmentProcessingService;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        AttachmentProcessingService,
        { provide: AttachmentUploadService, useValue: {} },
      ],
    });
    service = TestBed.inject(AttachmentProcessingService);
  });

  // Regression: a from-library (or deduped) attachment carries the redaction
  // mappings minted at its original upload. They must reach the completion inputs
  // so they're merged into the conversation and the placeholders hydrate —
  // otherwise the bubble shows raw `[[PII_…]]` tokens with no pill.
  it('carries the library file redaction mappings into the completion inputs', () => {
    const selection: LibrarySelection = {
      record: record('lib1'),
      fileName: 'cognos_test.txt',
      sizeBytes: 12,
      mimeType: 'text/plain',
      textContext: "what's my iban [[PII_IBAN_6JPRFO]]",
      redactionEntries: [ibanEntry],
    };

    expect(service.addFromLibrary([selection])).toBe(1);

    const inputs = service.completionInputs();
    expect(inputs.attachmentIds).toEqual(['lib1']);
    expect(inputs.redactionEntries).toHaveLength(1);
    expect(inputs.redactionEntries[0].token).toBe('[[PII_IBAN_6JPRFO]]');
    expect(inputs.redactionEntries[0].original).toBe('DE75512108001245126199');
  });
});

// EventTarget-ish stand-in for the real Worker: captures postMessage calls and
// lets the test drive `message` events back at the service, without ever
// spinning up a real Web Worker (unavailable/awkward in the vitest/jsdom
// environment). Installed as the global `Worker` constructor so the
// service's private `ensureWorker()` picks it up transparently.
class FakeWorker extends EventTarget {
  readonly postMessage = vi.fn();

  emit(data: unknown): void {
    this.dispatchEvent(new MessageEvent('message', { data }));
  }
}

const draft = (
  overrides: Partial<EncryptedAttachmentDraft> = {},
): EncryptedAttachmentDraft => ({
  clientAttachmentId: 'client-1',
  processorId: 'docx',
  manifestB64: 'c2VhbGVk',
  artifacts: [],
  display: {
    originalName: 'quarterly.docx',
    sizeBytes: 3,
    detectedMimeType:
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  },
  ai: { hasTextContext: true, textContext: 'body' },
  ...overrides,
});

describe('AttachmentProcessingService.saveToLibrary', () => {
  let service: AttachmentProcessingService;
  let fakeWorker: FakeWorker;
  const upload = vi.fn();
  const ownerPublicKey = new Uint8Array([1, 2, 3]);

  beforeEach(() => {
    upload.mockReset();
    // `Worker` must be `new`-able, so a plain arrow-function mock (rejected
    // with "is not a constructor") won't do — a construct-trap Proxy captures
    // the instance the service creates without needing a custom constructor.
    const WorkerConstructorStub = new Proxy(FakeWorker, {
      construct(target, args) {
        fakeWorker = new target(...(args as []));
        return fakeWorker;
      },
    });
    vi.stubGlobal('Worker', WorkerConstructorStub);

    TestBed.configureTestingModule({
      providers: [
        AttachmentProcessingService,
        { provide: AttachmentUploadService, useValue: { upload } },
      ],
    });
    service = TestBed.inject(AttachmentProcessingService);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  function lastRequest(): { requestId: string; type: string } {
    const calls = fakeWorker.postMessage.mock.calls;
    return calls[calls.length - 1][0];
  }

  it('sends a process request without adding to the composer selection', () => {
    const file = new File(['body'], 'quarterly.docx');
    void service.saveToLibrary(file, ownerPublicKey, true);

    const request = lastRequest() as unknown as {
      type: string;
      file: File;
      ownerPublicKey: Uint8Array;
      redact: boolean;
      preferRawForPdf: boolean;
    };
    expect(request.type).toBe('process');
    expect(request.file).toBe(file);
    expect(request.ownerPublicKey).toBe(ownerPublicKey);
    expect(request.redact).toBe(true);
    // Not tied to any model's file-input capability — a library save always
    // extracts text so a reused PDF keeps context regardless of which model
    // is selected later.
    expect(request.preferRawForPdf).toBe(false);
    expect(service.attachments()).toEqual([]);
    expect(service.count()).toBe(0);
  });

  it('resolves once the worker reports ready and the upload succeeds', async () => {
    upload.mockReturnValue(of(record('lib-9')));
    const file = new File(['body'], 'quarterly.docx');

    const promise = service.saveToLibrary(file, ownerPublicKey);
    const { requestId } = lastRequest();
    fakeWorker.emit({ type: 'ready', requestId, result: draft() });

    await expect(promise).resolves.toBeUndefined();
    expect(upload).toHaveBeenCalledWith(draft());
    expect(service.attachments()).toEqual([]);
  });

  it('rejects when the worker reports a processing failure, without touching the selection', async () => {
    const file = new File(['body'], 'sheet.xlsx');

    const promise = service.saveToLibrary(file, ownerPublicKey);
    const { requestId } = lastRequest();
    fakeWorker.emit({
      type: 'failed',
      requestId,
      error: { code: 'unsupported_type', message: 'No processor for this file type' },
    });

    await expect(promise).rejects.toMatchObject({
      name: 'AttachmentProcessingError',
      code: 'unsupported_type',
    });
    expect(upload).not.toHaveBeenCalled();
    expect(service.attachments()).toEqual([]);
  });

  it('rejects when the upload itself fails after a successful render', async () => {
    upload.mockReturnValue(throwError(() => new Error('network down')));
    const file = new File(['body'], 'quarterly.docx');

    const promise = service.saveToLibrary(file, ownerPublicKey);
    const { requestId } = lastRequest();
    fakeWorker.emit({ type: 'ready', requestId, result: draft() });

    await expect(promise).rejects.toMatchObject({
      name: 'AttachmentProcessingError',
      code: 'processing_failed',
    });
  });

  it('ignores progress events for a pending library save (no selection to patch)', () => {
    const file = new File(['body'], 'quarterly.docx');
    void service.saveToLibrary(file, ownerPublicKey);
    const { requestId } = lastRequest();

    expect(() =>
      fakeWorker.emit({ type: 'progress', requestId, stage: 'encrypting' }),
    ).not.toThrow();
    expect(service.attachments()).toEqual([]);
  });

  it('does not interfere with a concurrent composer add() correlated by its own requestId', () => {
    const file = new File(['body'], 'quarterly.docx');
    service.add([file], ownerPublicKey);
    expect(service.count()).toBe(1);

    void service.saveToLibrary(new File(['other'], 'other.docx'), ownerPublicKey);

    // The library save must not create a second composer chip.
    expect(service.count()).toBe(1);
  });
});
