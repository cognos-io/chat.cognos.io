import {
  AttachmentProcessor,
  ProcessorInput,
  ProcessorOutput,
} from '../attachment.types';
import { extractPdfText } from '../extractors/pdf-extract';
import { extractPdfOcrText } from '../extractors/pdf-ocr-extract';
import { TextExtractor, runTextExtraction } from './text-extraction';

/** Extracts text from PDFs via pdfjs (lazy-loaded). When the text-layer pass
 * yields nothing (a scanned / text-less PDF), it falls back to client-side OCR
 * (tesseract.js, English only). Only when OCR also finds nothing does it fail
 * closed with `no_text_extracted`. */
export class PdfProcessor implements AttachmentProcessor {
  readonly id = 'pdf';
  readonly version = '1';
  readonly supportedExtensions = ['pdf'] as const;
  readonly supportedMimeTypes = ['application/pdf'] as const;
  readonly maxBytes = Number.POSITIVE_INFINITY;

  constructor(
    private readonly extract: TextExtractor = extractPdfText,
    private readonly ocr: TextExtractor = extractPdfOcrText,
  ) {}

  canProcess(input: ProcessorInput): boolean {
    return (
      input.detectedType.extension === 'pdf' ||
      input.detectedType.detectedMimeType === 'application/pdf'
    );
  }

  process(input: ProcessorInput): Promise<ProcessorOutput> {
    return runTextExtraction(this.extract, input, 'application/pdf', this.ocr);
  }
}
