import { TestBed } from '@angular/core/testing';

import { beforeEach, describe, expect, it } from 'vitest';

import { RedactionEntry } from '@app/redaction';

import { AttachmentProcessingService } from './attachment-processing.service';
import { LibrarySelection } from './attachment-selection';
import { AttachmentRecord, AttachmentUploadService } from './attachment-upload.service';

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
