import {
  AttachmentProcessingError,
  AttachmentProcessingLimits,
  ProcessorInput,
  ProcessorOutput,
} from '../attachment.types';

export type TextExtractor = (bytes: Uint8Array) => Promise<string>;

/**
 * runTextExtraction is the shared body for the document processors (PDF, DOCX):
 * run the injected extractor, fail with a clear `no_text_extracted` error when
 * nothing usable comes back (e.g. a scanned PDF), otherwise build the standard
 * extracted-text output. The extractor is injected so the processors can be
 * unit-tested without their heavy lazy-loaded libraries.
 *
 * An optional `fallback` extractor (e.g. OCR for a scanned/text-less PDF) runs
 * strictly when the fast primary pass returns empty text. OCR is expensive, so
 * it is gated behind the empty-text-layer condition and never runs otherwise.
 * The final `no_text_extracted` throw still applies when the fallback also finds
 * nothing.
 */
export const runTextExtraction = async (
  extract: TextExtractor,
  input: ProcessorInput,
  normalizedType: string,
  fallback?: TextExtractor,
): Promise<ProcessorOutput> => {
  let text: string;
  try {
    text = (await extract(input.bytes)).trim();
  } catch {
    throw new AttachmentProcessingError(
      'processing_failed',
      'Could not read this file',
    );
  }
  if (!text && fallback) {
    try {
      text = (await fallback(input.bytes)).trim();
    } catch {
      throw new AttachmentProcessingError(
        'processing_failed',
        'Could not read this file',
      );
    }
  }
  if (!text) {
    throw new AttachmentProcessingError(
      'no_text_extracted',
      'No text could be extracted',
    );
  }
  return buildExtractedTextOutput(text, input.limits, normalizedType);
};

/**
 * buildExtractedTextOutput turns extracted plaintext into the standard
 * ProcessorOutput shared by every text-yielding processor (plain text, PDF,
 * DOCX, Excel): one `extracted_text` artifact plus capped provider context.
 * Newlines are normalised; context is truncated to the per-file cap.
 */
export const buildExtractedTextOutput = (
  rawText: string,
  limits: AttachmentProcessingLimits,
  normalizedType = 'text/plain',
): ProcessorOutput => {
  const text = rawText.replace(/\r\n?/g, '\n');
  const extractedBytes = Uint8Array.from(new TextEncoder().encode(text));
  const charCount = text.length;
  const lineCount = text.length === 0 ? 0 : text.split('\n').length;

  const cap = limits.maxContextCharsPerFile;
  const truncated = charCount > cap;
  const textContext = truncated ? text.slice(0, cap) : text;

  return {
    normalizedType,
    artifacts: [
      {
        kind: 'extracted_text',
        mimeType: 'text/plain',
        bytes: extractedBytes,
        textStats: {
          char_count: charCount,
          line_count: lineCount,
          truncated_for_context: truncated,
        },
      },
    ],
    ai: {
      hasTextContext: textContext.trim().length > 0,
      textContext,
      textContextTruncated: truncated,
      preferredArtifactIndex: 0,
    },
  };
};
