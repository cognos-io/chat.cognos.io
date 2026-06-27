import { Base64 } from 'js-base64';
import nacl from 'tweetnacl';

import { hashBytes } from '../crypto/hash';
import { openSealedBox } from '../crypto/sealed-box';
import { openSecretBox } from '../crypto/secret-box';
import { processAttachment } from './attachment-pipeline';
import { AttachmentManifestV1, AttachmentProcessingError } from './attachment.types';

const bytes = (value: string): Uint8Array =>
  Uint8Array.from(new TextEncoder().encode(value));
const text = (value: Uint8Array): string => new TextDecoder().decode(value);

describe('processAttachment', () => {
  const keyPair = nacl.box.keyPair();

  const run = (fileName: string, content: string, mime = 'text/plain') =>
    processAttachment({
      fileName,
      declaredMimeType: mime,
      bytes: bytes(content),
      ownerPublicKey: keyPair.publicKey,
    });

  it('encrypts the original + extracted text and seals the manifest', async () => {
    const draft = await run('secret-notes.txt', 'TOP SECRET CONTENT');

    // Two artifacts, original first.
    expect(draft.artifacts).toHaveLength(2);
    expect(draft.artifacts[0].kind).toBe('original');
    expect(draft.artifacts[1].kind).toBe('extracted_text');

    // The manifest decrypts with the owner (user) key and is a library file (no
    // conversation binding — it's reusable across chats).
    const manifestBytes = openSealedBox(
      Base64.toUint8Array(draft.manifestB64),
      keyPair,
    );
    const manifest = JSON.parse(text(manifestBytes)) as AttachmentManifestV1;
    expect(manifest.kind).toBe('library_file');
    expect(manifest.conversation_id).toBeUndefined();
    expect(manifest.client_attachment_id).toBe(draft.clientAttachmentId);
    expect(manifest.original_name).toBe('secret-notes.txt');
    expect(manifest.artifacts).toHaveLength(2);

    // Each artifact decrypts with the manifest key and matches its hash.
    for (let i = 0; i < manifest.artifacts.length; i += 1) {
      const ma = manifest.artifacts[i];
      const key = Base64.toUint8Array(ma.key);
      const plaintext = openSecretBox(draft.artifacts[i].ciphertext, key);
      expect(Base64.fromUint8Array(hashBytes(plaintext))).toBe(ma.plaintext_hash);
    }

    // The original artifact round-trips to the exact input bytes.
    const original = openSecretBox(
      draft.artifacts[0].ciphertext,
      Base64.toUint8Array(manifest.artifacts[0].key),
    );
    expect(text(original)).toBe('TOP SECRET CONTENT');

    // Transient context is available for the provider.
    expect(draft.ai.hasTextContext).toBe(true);
    expect(draft.ai.textContext).toBe('TOP SECRET CONTENT');
  });

  it('redacts extracted text and stores the mappings in the manifest when asked', async () => {
    const draft = await processAttachment({
      fileName: 'pii.txt',
      declaredMimeType: 'text/plain',
      bytes: bytes('email me at jane@example.com about it'),
      ownerPublicKey: keyPair.publicKey,
      redact: true,
    });

    // The transient provider context is redacted — never the raw value.
    expect(draft.ai.textContext).not.toContain('jane@example.com');
    expect(draft.ai.textContext).toMatch(/\[\[PII_EMAIL_[A-Z0-9]+\]\]/);
    expect(draft.ai.redactionEntries).toHaveLength(1);
    expect(draft.ai.redactionEntries?.[0].original).toBe('jane@example.com');

    // The mappings travel sealed in the manifest (recoverable for reuse).
    const manifestBytes = openSealedBox(
      Base64.toUint8Array(draft.manifestB64),
      keyPair,
    );
    const manifest = JSON.parse(text(manifestBytes)) as AttachmentManifestV1;
    expect(manifest.redactions).toHaveLength(1);
    expect(manifest.redactions?.[0].original).toBe('jane@example.com');
  });

  it('leaves extracted text untouched when redaction is off', async () => {
    const draft = await processAttachment({
      fileName: 'pii.txt',
      declaredMimeType: 'text/plain',
      bytes: bytes('email me at jane@example.com'),
      ownerPublicKey: keyPair.publicKey,
      // redact omitted (defaults off)
    });
    expect(draft.ai.textContext).toContain('jane@example.com');
    expect(draft.ai.redactionEntries).toBeUndefined();
  });

  it('never exposes the filename or plaintext content in the sealed manifest', async () => {
    const draft = await run('my-private-file.txt', 'CONFIDENTIAL BODY TEXT');
    // The sealed base64 must not contain the plaintext name or content.
    const decoded = Base64.toUint8Array(draft.manifestB64);
    const asText = String.fromCharCode(...decoded);
    expect(asText).not.toContain('my-private-file');
    expect(asText).not.toContain('CONFIDENTIAL BODY TEXT');
    // Nor may the encrypted artifact bytes contain the plaintext.
    for (const artifact of draft.artifacts) {
      expect(String.fromCharCode(...artifact.ciphertext)).not.toContain(
        'CONFIDENTIAL BODY TEXT',
      );
    }
  });

  it('sends a PDF raw (no extraction) when the model accepts native files', async () => {
    const pdfBytes = bytes('%PDF-1.4 fake pdf body');
    const draft = await processAttachment({
      fileName: 'report.pdf',
      declaredMimeType: 'application/pdf',
      bytes: pdfBytes,
      ownerPublicKey: keyPair.publicKey,
      preferRawForPdf: true,
    });

    // Only the original artifact is stored (no extracted_text), and a raw file
    // context is emitted for the provider.
    expect(draft.artifacts).toHaveLength(1);
    expect(draft.artifacts[0].kind).toBe('original');
    expect(draft.ai.hasTextContext).toBe(false);
    expect(draft.ai.fileContext?.mimeType).toBe('application/pdf');
    expect(draft.ai.fileContext?.fileName).toBe('report.pdf');
    expect(draft.ai.fileContext?.base64).toBe(Base64.fromUint8Array(pdfBytes));
    expect(draft.processorId).toBe('pdf-raw');
  });

  it('rejects unsupported binary files (fail closed)', async () => {
    await expect(
      processAttachment({
        fileName: 'photo.png',
        declaredMimeType: 'image/png',
        bytes: Uint8Array.from([0x89, 0x50, 0x4e, 0x47]),
        ownerPublicKey: keyPair.publicKey,
      }),
    ).rejects.toBeInstanceOf(AttachmentProcessingError);
  });

  it('rejects empty and oversized files', async () => {
    await expect(
      processAttachment({
        fileName: 'empty.txt',
        declaredMimeType: 'text/plain',
        bytes: new Uint8Array(0),
        ownerPublicKey: keyPair.publicKey,
      }),
    ).rejects.toThrow();

    await expect(
      processAttachment({
        fileName: 'big.txt',
        declaredMimeType: 'text/plain',
        bytes: bytes('xxxxxxxxxx'),
        ownerPublicKey: keyPair.publicKey,
        limits: { maxBytes: 4, maxContextCharsPerFile: 100 },
      }),
    ).rejects.toThrow();
  });
});
