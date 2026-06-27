import { Base64 } from 'js-base64';

import { hashBytes } from '../crypto/hash';
import { createSealedBox } from '../crypto/sealed-box';
import { randomSecretKey, secretBox } from '../crypto/secret-box';
import { detectFileType } from './attachment-type-detection';
import {
  AttachmentManifestV1,
  AttachmentProcessingError,
  AttachmentProcessingLimits,
  AttachmentProcessor,
  EncryptedArtifactDraft,
  EncryptedAttachmentDraft,
  ManifestArtifact,
  ProcessorOutput,
  UnencryptedArtifact,
  defaultAttachmentLimits,
} from './attachment.types';
import { defaultProcessors, selectProcessor } from './processors/processor-registry';

export interface ProcessAttachmentInput {
  fileName: string;
  declaredMimeType: string;
  bytes: Uint8Array;
  conversationId: string;
  conversationPublicKey: Uint8Array;
  limits?: AttachmentProcessingLimits;
  processors?: readonly AttachmentProcessor[];
  // When true and the file is a PDF, skip text extraction and send the raw file
  // to the model (the selected model accepts native file input).
  preferRawForPdf?: boolean;
}

const isPdf = (detected: { extension: string; detectedMimeType: string }): boolean =>
  detected.extension === 'pdf' || detected.detectedMimeType === 'application/pdf';

const newId = (): string => {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // Fallback: random hex (sufficient for a client-side opaque id).
  const buf = new Uint8Array(16);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
};

const encryptArtifact = (
  artifact: UnencryptedArtifact,
): { draft: EncryptedArtifactDraft; manifest: ManifestArtifact } => {
  const artifactId = newId();
  const key = randomSecretKey();
  const ciphertext = secretBox(artifact.bytes, key);
  const hash = hashBytes(artifact.bytes);

  return {
    draft: {
      artifactId,
      kind: artifact.kind,
      mimeType: artifact.mimeType,
      ciphertextSize: ciphertext.length,
      ciphertext,
    },
    manifest: {
      artifact_id: artifactId,
      kind: artifact.kind,
      mime_type: artifact.mimeType,
      size_bytes: artifact.bytes.length,
      key: Base64.fromUint8Array(key),
      plaintext_hash: Base64.fromUint8Array(hash),
      text_stats: artifact.textStats,
    },
  };
};

/**
 * processAttachment runs the full client-side pipeline for one file: detect →
 * process → encrypt each artifact under a random key → seal the manifest to the
 * conversation public key. It never returns plaintext bytes for storage; only
 * the transient `ai.textContext` is plaintext (for the provider request).
 *
 * Pure and framework-free so it can run inside the Web Worker and be unit
 * tested directly.
 */
export const processAttachment = async (
  input: ProcessAttachmentInput,
): Promise<EncryptedAttachmentDraft> => {
  const limits = input.limits ?? defaultAttachmentLimits();
  const processors = input.processors ?? defaultProcessors();

  if (input.bytes.length === 0) {
    throw new AttachmentProcessingError('empty_file', 'File is empty');
  }
  if (input.bytes.length > limits.maxBytes) {
    throw new AttachmentProcessingError(
      'file_too_large',
      'File exceeds the size limit',
    );
  }

  const detectedType = detectFileType(input.fileName, input.declaredMimeType);
  const processorInput = {
    fileName: input.fileName,
    bytes: input.bytes,
    detectedType,
    limits,
  };

  // Raw PDF passthrough: when the model accepts native files, send the original
  // PDF instead of client-extracted text (better quality, skips pdfjs).
  let processorId: string;
  let processorVersion = '1';
  let output: ProcessorOutput;
  if (input.preferRawForPdf && isPdf(detectedType)) {
    processorId = 'pdf-raw';
    output = {
      normalizedType: 'application/pdf',
      artifacts: [],
      ai: {
        hasTextContext: false,
        fileContext: {
          base64: Base64.fromUint8Array(input.bytes),
          mimeType: 'application/pdf',
          fileName: input.fileName,
        },
      },
    };
  } else {
    const processor = selectProcessor(processors, processorInput);
    processorId = processor.id;
    processorVersion = processor.version;
    output = await processor.process(processorInput);
  }

  // The original is always artifact[0]; derived artifacts follow in order.
  const allArtifacts: UnencryptedArtifact[] = [
    { kind: 'original', mimeType: detectedType.detectedMimeType, bytes: input.bytes },
    ...output.artifacts,
  ];

  const encryptedArtifacts: EncryptedArtifactDraft[] = [];
  const manifestArtifacts: ManifestArtifact[] = [];
  for (const artifact of allArtifacts) {
    const { draft, manifest } = encryptArtifact(artifact);
    encryptedArtifacts.push(draft);
    manifestArtifacts.push(manifest);
  }

  // preferredArtifactIndex is relative to derived artifacts → offset by 1 for
  // the leading original.
  let preferredArtifactId: string | undefined;
  if (output.ai.preferredArtifactIndex !== undefined) {
    preferredArtifactId =
      manifestArtifacts[1 + output.ai.preferredArtifactIndex]?.artifact_id;
  }

  const clientAttachmentId = newId();
  const manifest: AttachmentManifestV1 = {
    version: '1',
    kind: 'conversation_attachment',
    client_attachment_id: clientAttachmentId,
    conversation_id: input.conversationId,
    original_name: input.fileName,
    declared_mime_type: detectedType.declaredMimeType,
    detected_mime_type: detectedType.detectedMimeType,
    extension: detectedType.extension,
    processor: { id: processorId, version: processorVersion, status: 'processed' },
    artifacts: manifestArtifacts,
    ai: {
      has_text_context: output.ai.hasTextContext,
      preferred_artifact_id: preferredArtifactId,
      context_char_count: output.ai.textContext?.length,
      context_truncated: output.ai.textContextTruncated,
    },
    created_at: new Date().toISOString(),
  };

  // Uint8Array.from guarantees a same-realm typed array for tweetnacl (some test
  // environments hand back a foreign Uint8Array from TextEncoder).
  const manifestBytes = Uint8Array.from(
    new TextEncoder().encode(JSON.stringify(manifest)),
  );
  const sealed = createSealedBox(manifestBytes, input.conversationPublicKey);

  return {
    clientAttachmentId,
    conversationId: input.conversationId,
    processorId,
    manifestB64: Base64.fromUint8Array(sealed),
    artifacts: encryptedArtifacts,
    display: {
      originalName: input.fileName,
      sizeBytes: input.bytes.length,
      detectedMimeType: detectedType.detectedMimeType,
    },
    ai: {
      hasTextContext: output.ai.hasTextContext,
      textContext: output.ai.textContext,
      contextTruncated: output.ai.textContextTruncated,
      imageContext: output.ai.imageContext,
      fileContext: output.ai.fileContext,
    },
  };
};
