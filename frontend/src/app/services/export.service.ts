import { Injectable, inject } from '@angular/core';

import { firstValueFrom } from 'rxjs';

import { zipSync } from 'fflate';
import { Base64 } from 'js-base64';

import { Conversation } from '@app/interfaces/conversation';
import {
  MessageAttachment,
  MessageData,
  isMessageFromUser,
  parseMessageData,
} from '@app/interfaces/message';
import { saveBlob } from '@app/utils/save-blob';

import { CognosApiService } from './cognos-api.service';
import { ConversationService } from './conversation.service';
import { CryptoService } from './crypto.service';

const MESSAGE_PAGE_SIZE = 100;

// ExportedAttachment references a decrypted image bundled alongside the JSON in
// the export archive. `file` is the archive-relative path to the image bytes.
export interface ExportedAttachment {
  kind: string;
  mime_type: string;
  file: string;
  width?: number;
  height?: number;
}

export interface ExportedMessage {
  record_id?: string;
  // The record id of the message this one replies to, preserving the thread
  // structure (which assistant reply answers which prompt) in the export.
  parent_message_id?: string;
  created_at?: string;
  role: 'user' | 'assistant';
  content: string | null;
  model_id?: string;
  persona_id?: string;
  // Decrypted image attachments, each pointing at a file in the archive.
  attachments?: ExportedAttachment[];
}

// The decrypted image files gathered during an export, keyed by their
// archive-relative path (matching ExportedAttachment.file).
type ExportImages = Map<string, Uint8Array>;

const EXPORT_JSON_NAME = 'conversation.json';

export interface ExportedConversation {
  id: string;
  title: string;
  created: string;
  updated: string;
  messages: ExportedMessage[];
}

export interface ExportPayload {
  version: '1';
  exported_at: string;
  conversation_count: number;
  conversations: ExportedConversation[];
}

// ExportService gathers all of the user's conversations and messages and
// decrypts them in the browser into a single JSON payload the user can
// download. Decryption happens client-side only — no plaintext ever leaves the
// device — which is the whole point of an export for an end-to-end encrypted
// product.
@Injectable({ providedIn: 'root' })
export class ExportService {
  private readonly _api = inject(CognosApiService);
  private readonly _conversations = inject(ConversationService);
  private readonly _crypto = inject(CryptoService);

  async buildExport(now: Date): Promise<ExportPayload> {
    const { payload } = await this.gather(this._conversations.conversationList(), now);
    return payload;
  }

  // downloadExport builds the payload and triggers a browser download. When any
  // conversation has generated images, the download is a .zip bundling the JSON
  // with the decrypted images; otherwise it stays a plain .json.
  async downloadExport(now: Date): Promise<ExportPayload> {
    const { payload, images } = await this.gather(
      this._conversations.conversationList(),
      now,
    );
    this.deliver(payload, images, `cognos-export-${now.toISOString().slice(0, 10)}`);
    return payload;
  }

  // Single-conversation variant, sharing the export format (one entry) so the
  // file reads the same whether one chat or all of them were exported.
  async buildConversationExport(
    conversation: Conversation,
    now: Date,
  ): Promise<ExportPayload> {
    const { payload } = await this.gather([conversation], now);
    return payload;
  }

  async downloadConversationExport(
    conversation: Conversation,
    now: Date,
  ): Promise<ExportPayload> {
    const { payload, images } = await this.gather([conversation], now);
    this.deliver(payload, images, this.conversationFilename(conversation, now));
    return payload;
  }

  // gather decrypts every conversation's messages and their image attachments,
  // accumulating the decrypted image bytes into a single archive map shared
  // across conversations (record ids are globally unique, so paths don't clash).
  private async gather(
    conversations: Conversation[],
    now: Date,
  ): Promise<{ payload: ExportPayload; images: ExportImages }> {
    const images: ExportImages = new Map();
    const exported: ExportedConversation[] = [];
    for (const conversation of conversations) {
      exported.push(await this.exportConversation(conversation, images));
    }
    return { payload: this.wrap(exported, now), images };
  }

  private wrap(conversations: ExportedConversation[], now: Date): ExportPayload {
    return {
      version: '1',
      exported_at: now.toISOString(),
      conversation_count: conversations.length,
      conversations,
    };
  }

  private async exportConversation(
    conversation: Conversation,
    images: ExportImages,
  ): Promise<ExportedConversation> {
    return {
      id: conversation.record.id,
      title: conversation.decryptedData.title,
      created: conversation.record.created,
      updated: conversation.record.updated,
      messages: await this.exportMessages(conversation, images),
    };
  }

  private async exportMessages(
    conversation: Conversation,
    images: ExportImages,
  ): Promise<ExportedMessage[]> {
    const messages: ExportedMessage[] = [];

    let page = 1;
    let totalPages = 1;
    do {
      const response = await firstValueFrom(
        this._api.listConversationMessages(
          conversation.record.id,
          page,
          MESSAGE_PAGE_SIZE,
        ),
      );
      totalPages = response.totalPages;

      for (const record of response.items) {
        const data = this.decrypt(record.data, conversation);
        messages.push({
          record_id: record.id,
          parent_message_id: data.parent_message_id,
          created_at: data.created_at,
          role: isMessageFromUser(data) ? 'user' : 'assistant',
          content: data.content,
          model_id: data.model_id,
          persona_id: data.persona_id,
          attachments: await this.exportAttachments(
            conversation,
            record.id,
            data.attachments,
            images,
          ),
        });
      }

      page += 1;
    } while (page <= totalPages);

    // The list endpoint returns newest-first; export oldest-first so the file
    // reads as a transcript.
    return messages.sort((a, b) =>
      (a.created_at ?? '').localeCompare(b.created_at ?? ''),
    );
  }

  // exportAttachments fetches and decrypts each image attachment, adds the bytes
  // to the archive map, and returns the JSON references. Returns undefined when
  // the message has no attachments (so the field stays absent for text turns).
  // A failed fetch/decrypt skips that image rather than failing the whole export.
  private async exportAttachments(
    conversation: Conversation,
    messageId: string,
    attachments: MessageAttachment[] | undefined,
    images: ExportImages,
  ): Promise<ExportedAttachment[] | undefined> {
    if (!attachments?.length) {
      return undefined;
    }

    const exported: ExportedAttachment[] = [];
    for (let index = 0; index < attachments.length; index += 1) {
      const attachment = attachments[index];
      const bytes = await this.decryptAttachment(conversation, messageId, attachment);
      if (!bytes) {
        continue;
      }
      const file = `images/${messageId}-${index}.${extForMime(attachment.mime_type)}`;
      images.set(file, bytes);
      exported.push({
        kind: attachment.kind,
        mime_type: attachment.mime_type,
        file,
        width: attachment.width,
        height: attachment.height,
      });
    }

    return exported.length ? exported : undefined;
  }

  private async decryptAttachment(
    conversation: Conversation,
    messageId: string,
    attachment: MessageAttachment,
  ): Promise<Uint8Array | null> {
    try {
      const ciphertext = await firstValueFrom(
        this._api.fetchAttachmentBytes(conversation.record.id, messageId),
      );
      // Only generated images carry a sealed_key + bytes on the message record;
      // user uploads have none here, so there is nothing to decrypt for export.
      if (!attachment.sealed_key) {
        return null;
      }
      const symmetricKey = this._crypto.openSealedBox(
        Base64.toUint8Array(attachment.sealed_key),
        conversation.keyPair,
      );
      return this._crypto.openSecretBox(ciphertext, symmetricKey);
    } catch {
      return null;
    }
  }

  private decrypt(base64Data: string, conversation: Conversation): MessageData {
    try {
      return parseMessageData(
        this._crypto.openSealedBox(
          Base64.toUint8Array(base64Data),
          conversation.keyPair,
        ),
      );
    } catch {
      return { content: null };
    }
  }

  // Filename for a single chat: a slug of its title (falling back to the id)
  // plus the export date.
  private conversationFilename(conversation: Conversation, now: Date): string {
    const slug = conversation.decryptedData.title
      ?.toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 50);
    const base = slug || conversation.record.id;
    return `cognos-${base}-${now.toISOString().slice(0, 10)}`;
  }

  // deliver downloads the export: a plain .json when there are no images, or a
  // .zip bundling conversation.json with the decrypted images/ folder otherwise.
  private deliver(
    payload: ExportPayload,
    images: ExportImages,
    filename: string,
  ): void {
    const json = JSON.stringify(payload, null, 2);

    if (images.size === 0) {
      this.download(new Blob([json], { type: 'application/json' }), `${filename}.json`);
      return;
    }

    const files: Record<string, Uint8Array> = {
      [EXPORT_JSON_NAME]: new TextEncoder().encode(json),
    };
    for (const [path, bytes] of images) {
      files[path] = bytes;
    }
    const zipped = zipSync(files);
    this.download(
      new Blob([zipped as BlobPart], { type: 'application/zip' }),
      `${filename}.zip`,
    );
  }

  private download(blob: Blob, filename: string): void {
    saveBlob(blob, filename);
  }
}

function extForMime(mimeType: string): string {
  switch (mimeType) {
    case 'image/jpeg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    default:
      return 'png';
  }
}
