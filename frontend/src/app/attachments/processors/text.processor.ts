import {
  AttachmentProcessingError,
  AttachmentProcessor,
  ProcessorInput,
  ProcessorOutput,
} from '../attachment.types';
import { buildExtractedTextOutput } from './text-extraction';

const SUPPORTED_EXTENSIONS = ['txt', 'text', 'md', 'markdown', 'csv', 'json'] as const;
const SUPPORTED_MIME_TYPES = [
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
] as const;

const containsNul = (bytes: Uint8Array): boolean => bytes.indexOf(0) >= 0;

const decodeStrictUtf8 = (bytes: Uint8Array): string => {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    throw new AttachmentProcessingError(
      'decode_failed',
      'File is not valid UTF-8 text',
    );
  }
};

const normalizeNewlines = (text: string): string => text.replace(/\r\n?/g, '\n');

/**
 * TextProcessor handles `.txt`, `.md`, `.csv` and valid UTF-8 `.json`. It fails
 * closed on binary / non-UTF-8 input so unsupported files
 * never reach the model as text.
 */
export class TextProcessor implements AttachmentProcessor {
  readonly id = 'text';
  readonly version = '1';
  readonly supportedExtensions = SUPPORTED_EXTENSIONS;
  readonly supportedMimeTypes = SUPPORTED_MIME_TYPES;
  readonly maxBytes = Number.POSITIVE_INFINITY;

  canProcess(input: ProcessorInput): boolean {
    if (input.detectedType.family === 'text') {
      return true;
    }
    return this.supportedExtensions.includes(
      input.detectedType.extension as (typeof SUPPORTED_EXTENSIONS)[number],
    );
  }

  async process(input: ProcessorInput): Promise<ProcessorOutput> {
    if (containsNul(input.bytes)) {
      throw new AttachmentProcessingError('decode_failed', 'File contains binary data');
    }

    let text = normalizeNewlines(decodeStrictUtf8(input.bytes));

    // For JSON, pretty-print when it parses; otherwise keep the raw text.
    if (
      input.detectedType.extension === 'json' ||
      input.detectedType.detectedMimeType === 'application/json'
    ) {
      try {
        text = JSON.stringify(JSON.parse(text), null, 2);
      } catch {
        // Not strict JSON — treat as plain text, still valid UTF-8.
      }
    }

    return buildExtractedTextOutput(
      text,
      input.limits,
      input.detectedType.detectedMimeType || 'text/plain',
    );
  }
}
