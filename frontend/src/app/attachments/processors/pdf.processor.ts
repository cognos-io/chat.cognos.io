import {
  AttachmentProcessor,
  ProcessorInput,
  ProcessorOutput,
} from '../attachment.types';
import { extractPdfText } from '../extractors/pdf-extract';
import { TextExtractor, runTextExtraction } from './text-extraction';

/** Extracts text from PDFs via pdfjs (lazy-loaded). Scanned/text-less PDFs fail
 * closed with `no_text_extracted` (OCR is a future phase). */
export class PdfProcessor implements AttachmentProcessor {
  readonly id = 'pdf';
  readonly version = '1';
  readonly supportedExtensions = ['pdf'] as const;
  readonly supportedMimeTypes = ['application/pdf'] as const;
  readonly maxBytes = Number.POSITIVE_INFINITY;

  constructor(private readonly extract: TextExtractor = extractPdfText) {}

  canProcess(input: ProcessorInput): boolean {
    return (
      input.detectedType.extension === 'pdf' ||
      input.detectedType.detectedMimeType === 'application/pdf'
    );
  }

  process(input: ProcessorInput): Promise<ProcessorOutput> {
    return runTextExtraction(this.extract, input, 'application/pdf');
  }
}
