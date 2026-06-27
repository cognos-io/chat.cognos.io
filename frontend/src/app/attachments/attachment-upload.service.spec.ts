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

  it('uploads a multipart draft to the library and maps the response', () => {
    let result: { id: string; files: string[]; sizeBytes: number } | undefined;
    service.upload(draft()).subscribe((r) => (result = r));

    const req = http.expectOne('http://localhost:8090/api/v1/attachments');
    expect(req.request.method).toBe('POST');
    expect(req.request.headers.get('Authorization')).toBe('Bearer tok');
    const body = req.request.body as FormData;
    expect(body.get('data')).toBe('c2VhbGVk');
    expect(body.getAll('files')).toHaveLength(2);

    req.flush({
      id: 'rec1',
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

  it('lists the library', () => {
    service.list().subscribe();
    const req = http.expectOne('http://localhost:8090/api/v1/attachments');
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });

  it('renames by replacing the sealed manifest', () => {
    service.updateManifest('rec1', 'bmV3').subscribe();
    const req = http.expectOne('http://localhost:8090/api/v1/attachments/rec1');
    expect(req.request.method).toBe('PATCH');
    expect(req.request.body).toEqual({ data: 'bmV3' });
    req.flush({
      id: 'rec1',
      size_bytes: 1,
      files: [],
      data: 'bmV3',
      created: 'n',
      updated: 'n',
    });
  });

  it('removes a library file', () => {
    service.remove('rec1').subscribe();
    const req = http.expectOne('http://localhost:8090/api/v1/attachments/rec1');
    expect(req.request.method).toBe('DELETE');
    req.flush(null);
  });

  it('lists usages for a library file', () => {
    service.usages('rec1').subscribe();
    const req = http.expectOne('http://localhost:8090/api/v1/attachments/rec1/usages');
    expect(req.request.method).toBe('GET');
    req.flush([]);
  });
});
