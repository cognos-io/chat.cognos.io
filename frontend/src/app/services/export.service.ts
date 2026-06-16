import { Injectable, inject } from '@angular/core';

import { firstValueFrom } from 'rxjs';

import { Base64 } from 'js-base64';

import { Conversation } from '@app/interfaces/conversation';
import {
  MessageData,
  isMessageFromUser,
  parseMessageData,
} from '@app/interfaces/message';

import { CognosApiService } from './cognos-api.service';
import { ConversationService } from './conversation.service';
import { CryptoService } from './crypto.service';

const MESSAGE_PAGE_SIZE = 100;

export interface ExportedMessage {
  record_id?: string;
  created_at?: string;
  role: 'user' | 'assistant';
  content: string | null;
  model_id?: string;
  persona_id?: string;
}

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
    const conversations = this._conversations.conversationList();

    const exported: ExportedConversation[] = [];
    for (const conversation of conversations) {
      exported.push({
        id: conversation.record.id,
        title: conversation.decryptedData.title,
        created: conversation.record.created,
        updated: conversation.record.updated,
        messages: await this.exportMessages(conversation),
      });
    }

    return {
      version: '1',
      exported_at: now.toISOString(),
      conversation_count: exported.length,
      conversations: exported,
    };
  }

  // downloadExport builds the payload and triggers a browser download of the
  // JSON file. Returns the payload so callers can report a summary.
  async downloadExport(now: Date): Promise<ExportPayload> {
    const payload = await this.buildExport(now);
    this.triggerDownload(payload, now);
    return payload;
  }

  private async exportMessages(conversation: Conversation): Promise<ExportedMessage[]> {
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
          created_at: data.created_at,
          role: isMessageFromUser(data) ? 'user' : 'assistant',
          content: data.content,
          model_id: data.model_id,
          persona_id: data.persona_id,
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

  private triggerDownload(payload: ExportPayload, now: Date): void {
    const blob = new Blob([JSON.stringify(payload, null, 2)], {
      type: 'application/json',
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `cognos-export-${now.toISOString().slice(0, 10)}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
  }
}
