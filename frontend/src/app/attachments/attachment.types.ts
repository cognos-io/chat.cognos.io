/**
 * Types for the client-side encrypted attachment pipeline (spec
 * docs/specs/attachments.md). These are framework-free so they can be shared by
 * the Angular services and the attachment Web Worker.
 */

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
  family: 'text' | 'unknown';
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

/** Encrypted manifest stored (sealed) in conversation_attachments.data. */
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
  kind: 'conversation_attachment';
  client_attachment_id: string;
  conversation_id: string;
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
  conversationId: string;
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
    textContext?: string;
    contextTruncated?: boolean;
  };
}

export type AttachmentProcessingErrorCode =
  | 'unsupported_type'
  | 'file_too_large'
  | 'decode_failed'
  | 'empty_file'
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
      conversationId: string;
      conversationPublicKey: Uint8Array;
      limits?: AttachmentProcessingLimits;
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
