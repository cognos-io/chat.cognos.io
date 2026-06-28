import { detectFileType } from '../attachment-type-detection';
import {
  AttachmentProcessingError,
  ProcessorInput,
  defaultAttachmentLimits,
} from '../attachment.types';
import { defaultProcessors, selectProcessor } from './processor-registry';

const inputFor = (fileName: string, mime = ''): ProcessorInput => ({
  fileName,
  bytes: Uint8Array.from([1, 2, 3]),
  detectedType: detectFileType(fileName, mime),
  limits: defaultAttachmentLimits(),
});

describe('processor registry', () => {
  it('selects the right processor per supported type', () => {
    const cases: [string, string, string][] = [
      ['notes.txt', '', 'text'],
      ['report.pdf', '', 'pdf'],
      ['memo.docx', '', 'docx'],
      ['cat.png', '', 'image'],
      ['cat.jpeg', '', 'image'],
    ];
    for (const [name, mime, id] of cases) {
      expect(selectProcessor(defaultProcessors(), inputFor(name, mime)).id).toBe(id);
    }
  });

  it('fails closed for unsupported files', () => {
    expect(() =>
      selectProcessor(defaultProcessors(), inputFor('clip.mp4', 'video/mp4')),
    ).toThrow(AttachmentProcessingError);
    // Spreadsheets are no longer accepted (xlsx parsing removed for launch).
    expect(() => selectProcessor(defaultProcessors(), inputFor('data.xlsx'))).toThrow(
      AttachmentProcessingError,
    );
    try {
      selectProcessor(defaultProcessors(), inputFor('archive.zip'));
    } catch (err) {
      expect((err as AttachmentProcessingError).code).toBe('unsupported_type');
    }
  });
});
