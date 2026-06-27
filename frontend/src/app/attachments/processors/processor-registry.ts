import {
  AttachmentProcessingError,
  AttachmentProcessor,
  ProcessorInput,
} from '../attachment.types';
import { DocxProcessor } from './docx.processor';
import { ExcelProcessor } from './excel.processor';
import { PdfProcessor } from './pdf.processor';
import { TextProcessor } from './text.processor';

/**
 * The processor registry is fail-closed: processors are tried in a fixed order
 * and the first whose `canProcess` returns true wins. If none accept the file,
 * the attachment is rejected before any upload (spec §0).
 */
export const defaultProcessors = (): readonly AttachmentProcessor[] => [
  new TextProcessor(),
  new PdfProcessor(),
  new DocxProcessor(),
  new ExcelProcessor(),
  // ImageProcessor registers here in the vision phase.
];

export const selectProcessor = (
  processors: readonly AttachmentProcessor[],
  input: ProcessorInput,
): AttachmentProcessor => {
  for (const processor of processors) {
    if (processor.canProcess(input)) {
      return processor;
    }
  }
  throw new AttachmentProcessingError(
    'unsupported_type',
    'No processor for this file type',
  );
};
