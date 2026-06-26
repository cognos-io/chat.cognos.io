import { provideHttpClient } from '@angular/common/http';
import {
  HttpTestingController,
  provideHttpClientTesting,
} from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';

import PocketBase from 'pocketbase';

import { AttachmentUploadService } from './attachment-upload.service';
import { EncryptedAttachmentDraft } from './attachment.types';

const draft = (): EncryptedAttachmentDraft => ({
  clientAttachmentId: 'cid',
  conversationId: 'conv1',
  processorId: 'text',
  manifestB64: 'c2VhbGVk',
  artifacts: [
    {
      artifactId: 'a0',
      kind: 'original',
      mimeType: 'text/plain',
      ciphertextSize: 3,
      ciphertext: Uint8Array.from([1, 2, 3]),
    },
    {
      artifactId: 'a1',
      kind: 'extracted_text',
      mimeType: 'text/plain',
      ciphertextSize: 2,
      ciphertext: Uint8Array.from([4, 5]),
    },
  ],
  display: { originalName: 'notes.txt', sizeBytes: 3, detectedMimeType: 'text/plain' },
  ai: { hasTextContext: true, textContext: 'hi' },
});

describe('AttachmentUploadService', () => {
  let service: AttachmentUploadService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(),
        provideHttpClientTesting(),
        AttachmentUploadService,
        { provide: PocketBase, useValue: { authStore: { token: 'tok' } } },
      ],
    });
    service = TestBed.inject(AttachmentUploadService);
    http = TestBed.inject(HttpTestingController);
  });

  afterEach(() => {
    http.verify();
    TestBed.resetTestingModule();
  });

  it('uploads a multipart draft and maps the response', () => {
    let result: { id: string; files: string[]; sizeBytes: number } | undefined;
    service.upload('conv1', draft()).subscribe((r) => (result = r));

    const req = http.expectOne(
      'http://localhost:8090/api/v1/conversations/conv1/attachments',
    );
    expect(req.request.method).toBe('POST');
    expect(req.request.headers.get('Authorization')).toBe('Bearer tok');
    const body = req.request.body as FormData;
    expect(body.get('data')).toBe('c2VhbGVk');
    expect(body.getAll('files')).toHaveLength(2);

    req.flush({
      id: 'rec1',
      conversation: 'conv1',
      size_bytes: 5,
      files: ['art-0_x.enc', 'art-1_y.enc'],
      data: 'c2VhbGVk',
      created: 'now',
      updated: 'now',
    });

    expect(result?.id).toBe('rec1');
    expect(result?.files).toEqual(['art-0_x.enc', 'art-1_y.enc']);
    expect(result?.sizeBytes).toBe(5);
  });

  it('lists attachments for a conversation', () => {
    service.list('conv1').subscribe();
    const req = http.expectOne(
      'http://localhost:8090/api/v1/conversations/conv1/attachments',
    );
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('deletes a draft attachment', () => {
    service.deleteDraft('conv1', 'rec1').subscribe();
    const req = http.expectOne(
      'http://localhost:8090/api/v1/conversations/conv1/attachments/rec1',
    );
    expect(req.request.method).toBe('DELETE');
    req.flush(null);
  });
});
