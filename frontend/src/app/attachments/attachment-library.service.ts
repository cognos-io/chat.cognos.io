import { Injectable, inject, signal } from '@angular/core';

import { Observable, catchError, firstValueFrom, from, map, of, switchMap } from 'rxjs';

import { Base64 } from 'js-base64';

import { hashBytes } from '@app/crypto/hash';
import {
  applyRedactions,
  defaultTokenGenerator,
  detectSensitiveText,
} from '@app/redaction';
import { CryptoService } from '@app/services/crypto.service';
import { VaultService } from '@app/services/vault.service';

import { LibrarySelection } from './attachment-selection';
import {
  AttachmentRecord,
  AttachmentUploadService,
  AttachmentUsage,
} from './attachment-upload.service';
import { AttachmentManifestV1 } from './attachment.types';

/**
 * The decrypted, display-side view of one library file. Built by opening the
 * owner-sealed manifest; raw bytes stay encrypted until a file is actually used
 * or downloaded.
 */
export interface LibraryFile {
  id: string;
  displayName: string;
  mimeType: string;
  sizeBytes: number;
  /** base64 blake2b of the original plaintext — used for client-side dedup. */
  plaintextHash: string;
  createdAt: string;
  hasTextContext: boolean;
  /** The decrypted manifest, kept so reuse/rename don't re-fetch. */
  manifest: AttachmentManifestV1;
  record: AttachmentRecord;
}

/**
 * AttachmentLibraryService is the read/manage face of the user's attachment
 * library. It lists records and opens their manifests with the vault key for
 * display, and "materialises" a chosen file back into provider context (+ the
 * redaction mappings) so it can be re-attached to a new message without
 * re-uploading. All decryption is client-side.
 */
@Injectable({ providedIn: 'root' })
export class AttachmentLibraryService {
  private readonly _upload = inject(AttachmentUploadService);
  private readonly _crypto = inject(CryptoService);
  private readonly _vault = inject(VaultService);

  /** Cached, decrypted library view. Refreshed on demand. */
  readonly files = signal<LibraryFile[]>([]);
  readonly loaded = signal(false);

  /** List the library and decrypt each manifest for display. */
  refresh(): Observable<LibraryFile[]> {
    return this._upload.list().pipe(
      map((records) => {
        const files = records
          .map((record) => this.toLibraryFile(record))
          .filter((file): file is LibraryFile => file !== null);
        this.files.set(files);
        this.loaded.set(true);
        return files;
      }),
    );
  }

  /** Find a library file by its original plaintext hash (dedup lookup). */
  findByHash(plaintextHash: string): LibraryFile | undefined {
    return this.files().find((f) => f.plaintextHash === plaintextHash);
  }

  /**
   * Split selected files into those already in the library (by content hash, to
   * reuse) and those that are new (to upload). Ensures the library is loaded so
   * the hash lookup is current. The blake2b hash matches the manifest's stored
   * plaintext_hash of the original artifact.
   */
  async splitNewVsExisting(
    files: readonly File[],
  ): Promise<{ toUpload: File[]; existing: LibraryFile[] }> {
    // Refresh (not just ensureLoaded) so a file uploaded earlier in this session
    // is visible to the hash lookup — uploads don't flow through this cache.
    try {
      await firstValueFrom(this.refresh());
    } catch {
      /* a failed list just means dedup is skipped this time */
    }
    const toUpload: File[] = [];
    const existing: LibraryFile[] = [];
    for (const file of files) {
      try {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const hash = Base64.fromUint8Array(hashBytes(bytes));
        const match = this.findByHash(hash);
        if (match) {
          existing.push(match);
          continue;
        }
      } catch {
        /* fall through to upload on any hashing failure */
      }
      toUpload.push(file);
    }
    return { toUpload, existing };
  }

  /**
   * Materialise a library file into a composer selection: download + decrypt its
   * extracted text, re-apply the stored redaction mappings (so the provider sees
   * placeholders and the originals hydrate), and carry the entries to merge into
   * the conversation. Image/raw-file reuse is deferred — those return text-less
   * selections (the model still receives the file reference).
   */
  materialize(file: LibraryFile): Observable<LibrarySelection> {
    const base: LibrarySelection = {
      record: file.record,
      fileName: file.displayName,
      sizeBytes: file.sizeBytes,
      mimeType: file.mimeType,
      processorId: file.manifest.processor.id,
    };

    const textArtifactIndex = file.manifest.artifacts.findIndex(
      (a) => a.kind === 'extracted_text',
    );
    if (!file.hasTextContext || textArtifactIndex < 0) {
      return from(Promise.resolve(base));
    }

    const artifact = file.manifest.artifacts[textArtifactIndex];
    const fileName = file.record.files[textArtifactIndex];
    return from(
      this._upload.downloadArtifact(file.record.id, fileName).then((ciphertext) => {
        const plaintext = this._crypto.openSecretBox(
          ciphertext,
          Base64.toUint8Array(artifact.key),
        );
        const rawText = new TextDecoder().decode(plaintext);
        const entries = file.manifest.redactions ?? [];
        // Re-derive the redacted text by reusing the stored mappings, so the
        // provider sees the same stable placeholders as the original upload.
        const candidates = detectSensitiveText(rawText);
        const redactedText =
          entries.length > 0 && candidates.length > 0
            ? applyRedactions(rawText, candidates, entries, defaultTokenGenerator)
                .redactedText
            : rawText;
        return {
          ...base,
          textContext: redactedText,
          contextTruncated: file.manifest.ai.context_truncated,
          redactionEntries: entries.length > 0 ? entries : undefined,
        };
      }),
    );
  }

  /**
   * Rename a library file. The display name lives in the manifest, so we re-seal
   * the manifest with the new name to the user's key and PATCH it. Refreshes the
   * cache on success.
   */
  rename(file: LibraryFile, newName: string): Observable<LibraryFile[]> {
    const keyPair = this._vault.keyPair();
    const trimmed = newName.trim();
    if (!keyPair || !trimmed) {
      return this.refresh();
    }
    const manifest: AttachmentManifestV1 = { ...file.manifest, original_name: trimmed };
    const sealed = this._crypto.createSealedBox(
      Uint8Array.from(new TextEncoder().encode(JSON.stringify(manifest))),
      keyPair.publicKey,
    );
    return this._upload
      .updateManifest(file.id, Base64.fromUint8Array(sealed))
      .pipe(switchMap(() => this.refresh()));
  }

  /** Remove a file from the library (referencing chats will tombstone it). */
  remove(id: string): Observable<LibraryFile[]> {
    return this._upload.remove(id).pipe(switchMap(() => this.refresh()));
  }

  /** List the conversations/messages that reference a library file. */
  usages(id: string): Observable<AttachmentUsage[]> {
    return this._upload.usages(id);
  }

  /**
   * Download + decrypt the original file's bytes in memory (nothing written to
   * disk). Used by data export to bundle the plaintext file into the archive.
   * Throws when the file has no stored original artifact.
   */
  async decryptOriginal(file: LibraryFile): Promise<Uint8Array> {
    const original = file.manifest.artifacts[0];
    const fileName = file.record.files[0];
    if (!original || !fileName) {
      throw new Error('library file has no original artifact');
    }
    const ciphertext = await this._upload.downloadArtifact(file.record.id, fileName);
    return this._crypto.openSecretBox(ciphertext, Base64.toUint8Array(original.key));
  }

  /** Download + decrypt the original file and save it to disk. */
  async download(file: LibraryFile): Promise<void> {
    if (!file.manifest.artifacts[0] || !file.record.files[0]) {
      return;
    }
    const plaintext = await this.decryptOriginal(file);
    const blob = new Blob([plaintext as BlobPart], { type: file.mimeType });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = file.displayName;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  /**
   * Fetch a library record by id and materialise it. Used to re-derive the
   * provider context for an attachment referenced by an earlier message, so a
   * stateless model keeps seeing it on follow-up turns. Resolves to null if the
   * file is gone or can't be opened.
   */
  materializeById(attachmentId: string): Observable<LibrarySelection | null> {
    return this._upload.get(attachmentId).pipe(
      switchMap((record) => {
        const file = this.toLibraryFile(record);
        return file ? this.materialize(file) : of(null);
      }),
      catchError(() => of(null)),
    );
  }

  private toLibraryFile(record: AttachmentRecord): LibraryFile | null {
    const keyPair = this._vault.keyPair();
    if (!keyPair) {
      return null;
    }
    try {
      const manifestBytes = this._crypto.openSealedBox(
        Base64.toUint8Array(record.data),
        keyPair,
      );
      const manifest = JSON.parse(
        new TextDecoder().decode(manifestBytes),
      ) as AttachmentManifestV1;
      return {
        id: record.id,
        displayName: manifest.original_name,
        mimeType: manifest.detected_mime_type,
        sizeBytes: record.sizeBytes,
        plaintextHash: manifest.artifacts[0]?.plaintext_hash ?? '',
        createdAt: record.created,
        hasTextContext: manifest.ai.has_text_context,
        manifest,
        record,
      };
    } catch {
      // A file we can't open (e.g. sealed to a rotated key) is skipped rather
      // than breaking the whole library view.
      return null;
    }
  }
}
