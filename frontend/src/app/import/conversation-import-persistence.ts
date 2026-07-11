import { Injectable, inject } from '@angular/core';

import { firstValueFrom } from 'rxjs';

import { Base64 } from 'js-base64';

import {
  Conversation,
  ConversationData,
  ConversationRecord,
} from '@app/interfaces/conversation';
import { MessageData } from '@app/interfaces/message';
import { AuthService } from '@app/services/auth.service';
import { CognosApiService } from '@app/services/cognos-api.service';
import { ConversationService } from '@app/services/conversation.service';
import { CryptoService } from '@app/services/crypto.service';
import { uniqueClientIds } from '@app/utils/client-id';

import { ImportSource, ImportedConversation } from './import-types';

@Injectable({
  providedIn: 'root',
})
export class ConversationImportPersistence {
  private readonly _api = inject(CognosApiService);
  private readonly _auth = inject(AuthService);
  private readonly _conversations = inject(ConversationService);
  private readonly _crypto = inject(CryptoService);

  async persist(
    source: ImportSource,
    imported: ImportedConversation,
  ): Promise<Conversation> {
    const ownerId = this._auth.user()?.['id'] as string | undefined;
    if (!ownerId) throw new Error('not_authenticated');
    const ids = uniqueClientIds(imported.messages.length + 1);
    const conversationId = ids[0];
    const messageIds = ids.slice(1);
    const keyPair = this._crypto.newKeyPair();
    const keyMaterial = this._conversations.buildNewConversationKeyMaterial(
      conversationId,
      ConversationData.parse({ title: imported.title }),
      keyPair,
    );
    const messages = imported.messages.map((message, index) => {
      const parentMessage = index === 0 ? '' : messageIds[index - 1];
      const payload: MessageData = {
        version: '1',
        content: message.text,
        conversation_id: conversationId,
        parent_message_id: parentMessage,
        created_at: message.createdAt,
        ...(message.role === 'user' ? { owner_id: ownerId } : {}),
      };
      return {
        id: messageIds[index],
        parent_message: parentMessage || undefined,
        data: Base64.fromUint8Array(
          this._crypto.createSealedBox(
            new TextEncoder().encode(JSON.stringify(payload)),
            keyPair.publicKey,
          ),
        ),
      };
    });
    const request = {
      import_id: crypto.randomUUID().replaceAll('-', '_'),
      source,
      conversation: { id: conversationId, ...keyMaterial, expiry_duration: '' },
      messages,
    } as const;
    const response = await firstValueFrom(this._api.importConversation(request));
    const record: ConversationRecord = {
      id: response.conversation.id,
      created: response.conversation.created,
      updated: response.conversation.updated,
      last_activity_at: response.conversation.last_activity_at,
      data: response.conversation.data,
      creator: response.conversation.creator,
      expiry_duration: response.conversation.expiry_duration,
    };
    const conversation: Conversation = {
      record,
      decryptedData: ConversationData.parse({ title: imported.title }),
      keyPair,
    };
    this._conversations.upsertConversations([conversation]);
    return conversation;
  }
}
