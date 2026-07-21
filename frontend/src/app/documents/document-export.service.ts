import { Injectable, InjectionToken, inject } from '@angular/core';

import { firstValueFrom } from 'rxjs';

import { TranslocoService } from '@jsverse/transloco';
import { Base64 } from 'js-base64';

import { AttachmentProcessingService } from '@app/attachments/attachment-processing.service';
import { CogDocBlock } from '@app/documents/cog-doc/cog-doc.types';
import { Conversation } from '@app/interfaces/conversation';
import { Message, MessageAttachment } from '@app/interfaces/message';
import { CognosApiService } from '@app/services/cognos-api.service';
import { ConversationService } from '@app/services/conversation.service';
import { CryptoService } from '@app/services/crypto.service';
import { RedactionService } from '@app/services/redaction.service';
import { VaultService } from '@app/services/vault.service';
import { saveBlob } from '@app/utils/save-blob';

import { filenameBaseFromSpec, renderOptionsFromSpec } from './cog-doc/cog-doc-parser';
import { documentFilename, documentMimeType } from './document-source';
import { DocumentWorkerClient } from './document-worker.client';
import {
  DocFormat,
  DocImage,
  DocumentRenderError,
  RenderOptions,
} from './document.types';
import { renderMarkdownFile } from './renderers/markdown-renderer';
import { SheetWarning } from './sheets/formula-validator';

/**
 * DI seams for the two side effects that would otherwise make this service
 * hard to unit test without a real Worker / a real DOM download: the render
 * worker client, and the browser download trigger. Both default to the real
 * thing so nothing changes for the app; specs override them with fakes.
 */
export const DOCUMENT_WORKER_CLIENT = new InjectionToken<DocumentWorkerClient>(
  'DOCUMENT_WORKER_CLIENT',
  { factory: () => new DocumentWorkerClient() },
);
export const DOCUMENT_SAVE_BLOB = new InjectionToken<typeof saveBlob>(
  'DOCUMENT_SAVE_BLOB',
  {
    factory: () => saveBlob,
  },
);

// The first `# Heading` line in the (hydrated) markdown source, used as a
// filename/title fallback when the conversation has no title yet.
const FIRST_H1_PATTERN = /^#\s+(.+)$/m;
const firstH1 = (markdown: string): string | undefined =>
  FIRST_H1_PATTERN.exec(markdown)?.[1]?.trim() || undefined;

/**
 * DocumentExportService turns one assistant (or user) message into a
 * downloadable file (docs/business_processes/document-generation.md). Content is
 * hydrated (redaction placeholders swapped back to originals) exactly like the
 * on-screen bubble, then handed to the render worker for docx/pdf, or encoded
 * directly for markdown. Any generated-image attachments on the message are
 * decrypted client-side and appended to the document.
 */
@Injectable({ providedIn: 'root' })
export class DocumentExportService {
  private readonly _redaction = inject(RedactionService);
  private readonly _conversations = inject(ConversationService);
  private readonly _api = inject(CognosApiService);
  private readonly _crypto = inject(CryptoService);
  private readonly _transloco = inject(TranslocoService);
  private readonly _workerClient = inject(DOCUMENT_WORKER_CLIENT);
  private readonly _saveBlob = inject(DOCUMENT_SAVE_BLOB);
  private readonly _vault = inject(VaultService);
  private readonly _attachmentProcessing = inject(AttachmentProcessingService);

  async downloadMessageAs(message: Message, format: DocFormat): Promise<void> {
    const content = message.decryptedData.content;
    if (!content) {
      throw new DocumentRenderError('empty_document', 'Nothing to export');
    }

    const conversation = this._conversations.conversation();
    const hydrated = this.hydrate(content, conversation);

    const conversationTitle = conversation?.decryptedData.title?.trim() || undefined;
    const baseName = conversationTitle ?? firstH1(hydrated);
    const filename = documentFilename(baseName, format, this.defaultFilenameFallback());

    if (format === 'markdown') {
      this._saveBlob(renderMarkdownFile(hydrated), filename, documentMimeType(format));
      return;
    }

    const images = await this.decryptGeneratedImages(message, conversation);
    await this.renderAndSave(format, hydrated, images, { title: baseName }, filename);
  }

  /**
   * renderCogDoc renders a model-authored `<cog-doc>` block (see
   * docs/business_processes/document-generation.md) to bytes without triggering
   * any side effect (no download, no upload) — the shared seam for
   * `downloadCogDoc` and `saveCogDocToLibrary` (spec). Only a fully
   * parsed, non-truncated block can be exported — 'streaming'/'invalid'
   * blocks (or a block whose `spec` failed validation) throw the same
   * `empty_document` error as an empty message, so callers' existing failure
   * UI applies unchanged.
   */
  async renderCogDoc(
    block: CogDocBlock,
    message: Message,
  ): Promise<{
    bytes: Uint8Array;
    filename: string;
    mime: string;
    warnings?: SheetWarning[];
  }> {
    if (block.state !== 'ready' || !block.spec) {
      throw new DocumentRenderError('empty_document', 'Document is not ready');
    }
    const spec = block.spec;

    const conversation = this._conversations.conversation();
    const hydrated = this.hydrate(block.body, conversation);

    const baseName = filenameBaseFromSpec(spec, block.body) ?? undefined;
    const filename = documentFilename(
      baseName,
      spec.format,
      this.defaultFilenameFallback(),
    );
    const options = renderOptionsFromSpec(spec);
    const mime = documentMimeType(spec.format);

    if (spec.format === 'xlsx') {
      // xlsx bodies are sheet-spec JSON, not markdown (spec), and never
      // carry images — but hydration still applies, since sheet cell strings
      // can contain redaction tokens like any other message content.
      const { bytes, warnings } = await this._workerClient.renderSheet(
        hydrated,
        options,
      );
      return {
        bytes,
        filename,
        mime,
        warnings: warnings.length > 0 ? warnings : undefined,
      };
    }

    const images = await this.decryptGeneratedImages(message, conversation);
    const bytes = await this._workerClient.render(
      spec.format,
      hydrated,
      images,
      options,
    );
    return { bytes, filename, mime };
  }

  /**
   * downloadCogDoc renders a `<cog-doc>` block and triggers a browser
   * download (spec). Returns the formula validator's advisory
   * warnings for xlsx documents (non-empty array), or `undefined` for
   * docx/pdf and for a warning-free xlsx render — the caller
   * (document-card) surfaces them after the download resolves.
   */
  async downloadCogDoc(
    block: CogDocBlock,
    message: Message,
  ): Promise<SheetWarning[] | undefined> {
    const { bytes, filename, mime, warnings } = await this.renderCogDoc(block, message);
    this._saveBlob(bytes, filename, mime);
    return warnings;
  }

  /**
   * saveCogDocToLibrary renders a `<cog-doc>` block and hands the bytes to
   * the encrypted attachment pipeline as a one-off save (spec) — the
   * bytes are frozen at the current renderer version, unlike the live
   * re-render `downloadCogDoc` performs on every click. This never touches
   * the composer's attachment selection (`AttachmentProcessingService.saveToLibrary`
   * correlates outside it), so no chip appears from a card save.
   */
  async saveCogDocToLibrary(block: CogDocBlock, message: Message): Promise<void> {
    const { bytes, filename, mime } = await this.renderCogDoc(block, message);
    // Copy into a plain ArrayBuffer so the File part type is unambiguous (TS
    // rejects a possibly-SharedArrayBuffer-backed Uint8Array) — mirrors
    // attachment-upload.service.ts's Blob construction.
    const buffer = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    ) as ArrayBuffer;
    const file = new File([buffer], filename, { type: mime });

    // The library seals to the user's own vault key (not the conversation
    // key), so the file is recoverable in any conversation — same source the
    // composer's attach flow uses (message-form.component.ts).
    const ownerPublicKey = this._vault.keyPair()?.publicKey;
    if (!ownerPublicKey) {
      throw new DocumentRenderError('render_failed', 'Vault is locked');
    }

    await this._attachmentProcessing.saveToLibrary(
      file,
      ownerPublicKey,
      this._redaction.enabled(),
    );
  }

  // hydrate resolves redaction placeholders in `content` back to their
  // originals for the given conversation/project scope — the same scoping
  // rule display uses, so the exported file shows real values.
  private hydrate(content: string, conversation: Conversation | undefined): string {
    return this._redaction.hydrate(
      conversation?.record.id,
      content,
      conversation?.record.project,
    );
  }

  private defaultFilenameFallback(): string {
    return this._transloco.translate('chat.message.documentDefaultName');
  }

  // renderAndSave is the shared docx/pdf tail: render via the worker, then
  // trigger the download. Markdown export never reaches here (it's a direct
  // encode, no worker round trip).
  private async renderAndSave(
    format: Exclude<DocFormat, 'markdown'>,
    hydrated: string,
    images: DocImage[],
    options: RenderOptions,
    filename: string,
  ): Promise<void> {
    const bytes = await this._workerClient.render(format, hydrated, images, options);
    this._saveBlob(bytes, filename, documentMimeType(format));
  }

  // decryptGeneratedImages resolves every generated-image attachment on the
  // message into DocImage bytes for the renderer. A single failed fetch/decrypt
  // skips that image rather than failing the whole export (fail open — the
  // document still renders, just without that image), mirroring
  // ExportService.decryptAttachment.
  private async decryptGeneratedImages(
    message: Message,
    conversation: Conversation | undefined,
  ): Promise<DocImage[]> {
    const messageId = message.record_id;
    const attachments = message.decryptedData.attachments ?? [];
    const generated = attachments.filter(
      (attachment) => attachment.kind === 'generated_image' && attachment.sealed_key,
    );
    if (!conversation || !messageId || generated.length === 0) {
      return [];
    }

    const images: DocImage[] = [];
    for (const attachment of generated) {
      const bytes = await this.decryptAttachment(conversation, messageId, attachment);
      if (bytes) {
        images.push({
          bytes,
          mime: attachment.mime_type,
          width: attachment.width,
          height: attachment.height,
        });
      }
    }
    return images;
  }

  private async decryptAttachment(
    conversation: Conversation,
    messageId: string,
    attachment: MessageAttachment,
  ): Promise<Uint8Array | null> {
    try {
      // Only generated images carry a sealed_key + bytes on the message record;
      // this path is never reached for user uploads (filtered out above).
      if (!attachment.sealed_key) {
        return null;
      }
      const ciphertext = await firstValueFrom(
        this._api.fetchAttachmentBytes(conversation.record.id, messageId),
      );
      const symmetricKey = this._crypto.openSealedBox(
        Base64.toUint8Array(attachment.sealed_key),
        conversation.keyPair,
      );
      return this._crypto.openSecretBox(ciphertext, symmetricKey);
    } catch {
      return null;
    }
  }
}
