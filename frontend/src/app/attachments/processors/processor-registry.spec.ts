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
  it('selects the text processor for supported files', () => {
    const processor = selectProcessor(defaultProcessors(), inputFor('notes.txt'));
    expect(processor.id).toBe('text');
  });

  it('fails closed for unsupported files', () => {
    expect(() =>
      selectProcessor(defaultProcessors(), inputFor('photo.png', 'image/png')),
    ).toThrow(AttachmentProcessingError);
    try {
      selectProcessor(defaultProcessors(), inputFor('archive.zip'));
    } catch (err) {
      expect((err as AttachmentProcessingError).code).toBe('unsupported_type');
    }
  });
});
