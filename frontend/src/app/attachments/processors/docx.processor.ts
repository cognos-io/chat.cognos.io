import {
  AttachmentProcessor,
  ProcessorInput,
  ProcessorOutput,
} from '../attachment.types';
import { extractDocxText } from '../extractors/docx-extract';
import { TextExtractor, runTextExtraction } from './text-extraction';

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

/** Extracts text from DOCX via mammoth (lazy-loaded). The legacy binary `.doc`
 * format is intentionally not handled — it falls through to unsupported. */
export class DocxProcessor implements AttachmentProcessor {
  readonly id = 'docx';
  readonly version = '1';
  readonly supportedExtensions = ['docx'] as const;
  readonly supportedMimeTypes = [DOCX_MIME] as const;
  readonly maxBytes = Number.POSITIVE_INFINITY;

  constructor(private readonly extract: TextExtractor = extractDocxText) {}

  canProcess(input: ProcessorInput): boolean {
    return (
      input.detectedType.extension === 'docx' ||
      input.detectedType.detectedMimeType === DOCX_MIME
    );
  }

  process(input: ProcessorInput): Promise<ProcessorOutput> {
    return runTextExtraction(this.extract, input, DOCX_MIME);
  }
}
