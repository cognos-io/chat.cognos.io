/**
 * Types for the client-side encrypted attachment pipeline (spec
 * docs/specs/attachments.md). These are framework-free so they can be shared by
 * the Angular services and the attachment Web Worker.
 */
import { RedactionEntry } from '@app/redaction';

/** USER_ATTACHMENT_* limits (spec §8.4). */
export const USER_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const USER_ATTACHMENT_MAX_COUNT_PER_MESSAGE = 4;
export const USER_ATTACHMENT_MAX_CONTEXT_CHARS_PER_FILE = 100_000;
export const USER_ATTACHMENT_MAX_CONTEXT_CHARS_PER_MESSAGE = 200_000;

export interface AttachmentProcessingLimits {
  maxBytes: number;
  maxContextCharsPerFile: number;
}

export const defaultAttachmentLimits = (): AttachmentProcessingLimits => ({
  maxBytes: USER_ATTACHMENT_MAX_BYTES,
  maxContextCharsPerFile: USER_ATTACHMENT_MAX_CONTEXT_CHARS_PER_FILE,
});

/** Detected type signals for a selected file. */
export interface DetectedFileType {
  extension: string; // lowercased, no dot (e.g. "txt")
  declaredMimeType: string; // browser-provided File.type (may be empty)
  detectedMimeType: string; // our best guess used for the manifest
  family: 'text' | 'document' | 'spreadsheet' | 'image' | 'unknown';
}

export interface ProcessorInput {
  fileName: string;
  bytes: Uint8Array;
  detectedType: DetectedFileType;
  limits: AttachmentProcessingLimits;
}

export type ArtifactKind =
  | 'original'
  | 'extracted_text'
  | 'text_chunk'
  | 'thumbnail'
  | 'model_image';

export interface ArtifactTextStats {
  char_count: number;
  line_count?: number;
  truncated_for_context: boolean;
}

/** A derived (plaintext) artifact produced by a processor, pre-encryption. */
export interface UnencryptedArtifact {
  kind: ArtifactKind;
  mimeType: string;
  bytes: Uint8Array;
  textStats?: ArtifactTextStats;
}

/** Model-ready image context for vision models (base64, no data: prefix). */
export interface ImageAiContext {
  base64: string;
  mimeType: string;
  width: number;
  height: number;
}

/** Raw file context for models with native file input (base64, no data: prefix). */
export interface FileAiContext {
  base64: string;
  mimeType: string;
  fileName: string;
}

export interface ProcessorOutput {
  normalizedType: string;
  /** Derived artifacts only — the pipeline always adds the original itself. */
  artifacts: UnencryptedArtifact[];
  ai: {
    hasTextContext: boolean;
    textContext?: string;
    textContextTruncated?: boolean;
    /** Index into the final artifacts array (after the original) — resolved by
     * the pipeline to an artifact_id. */
    preferredArtifactIndex?: number;
    /** Present for image attachments destined for vision models. */
    imageContext?: ImageAiContext;
    /** Present for raw files destined for file-capable models. */
    fileContext?: FileAiContext;
  };
}

export interface AttachmentProcessor {
  readonly id: string;
  readonly version: string;
  readonly supportedExtensions: readonly string[];
  readonly supportedMimeTypes: readonly string[];
  readonly maxBytes: number;
  canProcess(input: ProcessorInput): boolean;
  process(input: ProcessorInput): Promise<ProcessorOutput>;
}

/** Encrypted manifest stored (sealed) in user_attachments.data. */
export interface ManifestArtifact {
  artifact_id: string;
  kind: ArtifactKind;
  mime_type: string;
  size_bytes: number; // plaintext size
  key: string; // base64 raw 32-byte secretbox key (single seal — see spec §0)
  plaintext_hash: string; // base64 blake2b-256 of plaintext
  text_stats?: ArtifactTextStats;
}

export interface AttachmentManifestV1 {
  version: '1';
  // 'library_file': user-scoped, sealed to the owner's key, reusable across chats.
  // 'conversation_attachment' is the legacy pre-library value kept only so old
  // manifests still type-check while decrypting.
  kind: 'library_file' | 'conversation_attachment';
  client_attachment_id: string;
  // Optional: a library file is owned by the user, not bound to a conversation.
  // Legacy manifests may still carry the conversation they were created in.
  conversation_id?: string;
  original_name: string;
  declared_mime_type: string;
  detected_mime_type: string;
  extension: string;
  processor: { id: string; version: string; status: 'processed' | 'stored_only' };
  artifacts: ManifestArtifact[];
  ai: {
    has_text_context: boolean;
    preferred_artifact_id?: string;
    context_char_count?: number;
    context_truncated?: boolean;
  };
  // Redaction mappings minted over the extracted text at processing time. They
  // travel with the file (sealed in the manifest) so a reused library file keeps
  // stable placeholders, and are merged into a conversation's redaction scope
  // when the file is used there (spec docs/specs/pii-redaction.md §6.8).
  redactions?: RedactionEntry[];
  created_at: string;
}

/** One encrypted artifact ready to upload, with its ciphertext bytes. */
export interface EncryptedArtifactDraft {
  artifactId: string;
  kind: ArtifactKind;
  mimeType: string;
  ciphertextSize: number;
  ciphertext: Uint8Array;
}

/** The full encrypted draft the worker returns for one selected file. */
export interface EncryptedAttachmentDraft {
  clientAttachmentId: string;
  processorId: string;
  /** base64 sealed manifest for the `data` field. */
  manifestB64: string;
  /** Encrypted artifacts in canonical upload order (original first). */
  artifacts: EncryptedArtifactDraft[];
  /** Decrypted display metadata for the composer chip. */
  display: {
    originalName: string;
    sizeBytes: number; // original plaintext size
    detectedMimeType: string;
  };
  /** Transient provider context (never persisted). */
  ai: {
    hasTextContext: boolean;
    // Already redacted when redaction was enabled at processing — placeholders,
    // never raw values. The originals live only in `redactionEntries`.
    textContext?: string;
    contextTruncated?: boolean;
    imageContext?: ImageAiContext;
    fileContext?: FileAiContext;
    // Mappings minted over the extracted text; merged into the conversation's
    // redaction scope on send so the assistant's reply hydrates.
    redactionEntries?: RedactionEntry[];
  };
}

export type AttachmentProcessingErrorCode =
  | 'unsupported_type'
  | 'file_too_large'
  | 'decode_failed'
  | 'empty_file'
  | 'no_text_extracted'
  | 'image_decode_failed'
  | 'processing_failed';

export class AttachmentProcessingError extends Error {
  constructor(
    readonly code: AttachmentProcessingErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = 'AttachmentProcessingError';
  }
}

export type AttachmentProcessingStage =
  | 'queued'
  | 'processing'
  | 'encrypting'
  | 'uploading'
  | 'ready'
  | 'failed';

/** Worker protocol (spec §8.3). */
export type AttachmentWorkerRequest =
  | {
      type: 'process';
      requestId: string;
      file: File;
      // Public key the manifest + per-file keys are sealed to. The user's own
      // vault key, so the file is recoverable in any of their conversations.
      ownerPublicKey: Uint8Array;
      // When true, redact detected sensitive values in the extracted text before
      // it can reach the provider, minting mappings stored in the manifest.
      redact?: boolean;
      limits?: AttachmentProcessingLimits;
      // When true and the file is a PDF, send the raw file to the model instead
      // of extracting text (the selected model supports native file input).
      preferRawForPdf?: boolean;
    }
  | {
      type: 'cancel';
      requestId: string;
    };

export interface AttachmentWorkerErrorPayload {
  code: AttachmentProcessingErrorCode;
  message: string;
}

export type AttachmentWorkerEvent =
  | { type: 'progress'; requestId: string; stage: AttachmentProcessingStage }
  | { type: 'ready'; requestId: string; result: EncryptedAttachmentDraft }
  | { type: 'failed'; requestId: string; error: AttachmentWorkerErrorPayload };
