import { Injectable, InjectionToken, inject } from '@angular/core';

import { firstValueFrom } from 'rxjs';

import { TranslocoService } from '@jsverse/transloco';
import { Base64 } from 'js-base64';

import { Conversation } from '@app/interfaces/conversation';
import { Message, MessageAttachment } from '@app/interfaces/message';
import { CognosApiService } from '@app/services/cognos-api.service';
import { ConversationService } from '@app/services/conversation.service';
import { CryptoService } from '@app/services/crypto.service';
import { RedactionService } from '@app/services/redaction.service';
import { saveBlob } from '@app/utils/save-blob';

import { documentFilename, documentMimeType } from './document-source';
import { DocumentWorkerClient } from './document-worker.client';
import {
  DocFormat,
  DocImage,
  DocumentRenderError,
  RenderOptions,
} from './document.types';
import { renderMarkdownFile } from './renderers/markdown-renderer';

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
 * downloadable file (spec docs/specs/document-generation.md §5.1). Content is
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

  async downloadMessageAs(message: Message, format: DocFormat): Promise<void> {
    const content = message.decryptedData.content;
    if (!content) {
      throw new DocumentRenderError('empty_document', 'Nothing to export');
    }

    const conversation = this._conversations.conversation();
    const hydrated = this._redaction.hydrate(
      conversation?.record.id,
      content,
      conversation?.record.project,
    );

    const conversationTitle = conversation?.decryptedData.title?.trim() || undefined;
    const baseName = conversationTitle ?? firstH1(hydrated);
    const fallback = this._transloco.translate('chat.message.documentDefaultName');
    const filename = documentFilename(baseName, format, fallback);

    if (format === 'markdown') {
      this._saveBlob(renderMarkdownFile(hydrated), filename, documentMimeType(format));
      return;
    }

    const images = await this.decryptGeneratedImages(message, conversation);
    const options: RenderOptions = { title: baseName };
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
