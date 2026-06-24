import { Injectable, inject } from '@angular/core';

import { firstValueFrom } from 'rxjs';

import { Base64 } from 'js-base64';

import {
  Conversation,
  ConversationData,
  ConversationRecord,
} from '../interfaces/conversation';
import { KeyPair } from '../interfaces/key-pair';
import { uniqueClientIds } from '../utils/client-id';
import {
  ApiCopyConversationRequest,
  ApiCopyMessageInput,
  ApiCopyRedactionInput,
  ApiRedactionEntry,
  CognosApiService,
  MessageRecord,
} from './cognos-api.service';
import { ConversationService } from './conversation.service';
import { CryptoService } from './crypto.service';
import { VaultService } from './vault.service';

// Mirrors the backend cap (docs/specs/conversation-copy.md §13). Sources above
// this fail closed: v1 copy is one synchronous, single-transaction request.
export const MAX_COPY_MESSAGES = 500;

export const UserKeyPairMissingError = new Error(
  'conversation-copy: user key pair not available',
);
export const CannotDuplicateProjectError = new Error(
  'conversation-copy: project conversations cannot be duplicated yet',
);
export const CannotDuplicateAttachmentsError = new Error(
  'conversation-copy: conversations with attachments cannot be duplicated yet',
);
export const ConversationTooLargeError = new Error(
  'conversation-copy: conversation is too large to duplicate',
);
export const RedactionCopyError = new Error(
  'conversation-copy: failed to copy the PII redaction map',
);

// Decrypted source message ready to re-seal. We keep the raw plaintext JSON
// (not the zod-parsed subset) so the round-trip is lossless even if the server
// stored fields the client schema doesn't model yet.
interface DecryptedSourceMessage {
  record: MessageRecord;
  payload: Record<string, unknown>;
}

// Decrypted source redaction entry. The plaintext is kept opaque (raw bytes) so
// re-sealing never depends on the entry's internal shape.
interface DecryptedRedactionEntry {
  token: string;
  sourceKind: string;
  sourceId: string;
  plaintext: Uint8Array;
}

interface DecryptedRedaction {
  entries: DecryptedRedactionEntry[];
}

/**
 * ConversationCopyService implements the client half of "Duplicate chat".
 *
 * A duplicate is a brand-new conversation with a fresh keypair, so the browser
 * must decrypt every source payload and re-encrypt it to the duplicate key
 * before the backend can store it. This service does that work, bundles the
 * ciphertext, and POSTs it to the atomic copy endpoint — the server never sees
 * plaintext. See docs/specs/conversation-copy.md.
 *
 * v1 scope: standalone conversations, PII redaction copied, attachments and
 * project sources fail closed.
 */
@Injectable({ providedIn: 'root' })
export class ConversationCopyService {
  private readonly _crypto = inject(CryptoService);
  private readonly _api = inject(CognosApiService);
  private readonly _conversations = inject(ConversationService);
  private readonly _vault = inject(VaultService);

  /**
   * duplicate decrypts the source, re-encrypts it under a fresh keypair, and
   * persists the duplicate. Resolves with the new (decrypted) Conversation,
   * already inserted into the conversation store. Rejects with one of the typed
   * errors above (fail-closed guards) or a transport error.
   *
   * @param source the conversation to duplicate (carries its decrypted keypair)
   * @param duplicateTitle the title for the duplicate (caller supplies the
   *   localized "(copy)" suffix); falls back to the source title
   */
  async duplicate(
    source: Conversation,
    duplicateTitle?: string,
  ): Promise<Conversation> {
    const userKeyPair = this._vault.keyPair();
    if (!userKeyPair) {
      throw UserKeyPairMissingError;
    }

    // Fail closed on out-of-scope sources before doing any crypto.
    if (source.record.project) {
      throw CannotDuplicateProjectError;
    }

    const sourceMessages = await this.loadAndDecryptMessages(source);
    const redaction = await this.loadAndDecryptRedaction(source.record.id, userKeyPair);

    const title = (duplicateTitle ?? source.decryptedData.title ?? '').trim();

    // The encrypted payloads embed the final ids, so a 409 (an id already
    // exists) means the whole bundle must be regenerated — never patched. The
    // safe retry unit is the entire prepared bundle. Conflicts are
    // astronomically unlikely, so one retry is plenty.
    let prepared: { record: ConversationRecord; keyPair: KeyPair };
    try {
      prepared = await this.buildAndPost(
        source,
        sourceMessages,
        redaction,
        title,
        userKeyPair,
      );
    } catch (err) {
      if (!isConflict(err)) {
        throw err;
      }
      prepared = await this.buildAndPost(
        source,
        sourceMessages,
        redaction,
        title,
        userKeyPair,
      );
    }

    // Insert the duplicate into the store so the sidebar/header update
    // immediately — no re-fetch/re-decrypt round-trip needed.
    const conversation: Conversation = {
      record: prepared.record,
      decryptedData: ConversationData.parse({ title }),
      keyPair: prepared.keyPair,
    };
    this._conversations.upsertConversations([conversation]);
    return conversation;
  }

  // ── internals ────────────────────────────────────────────────────────────

  private async loadAndDecryptMessages(
    source: Conversation,
  ): Promise<DecryptedSourceMessage[]> {
    // One page covers the whole conversation: anything above the cap fails
    // closed, so there is never a second page to fetch.
    const response = await firstValueFrom(
      this._api.listConversationMessages(source.record.id, 1, MAX_COPY_MESSAGES),
    );
    if (response.totalItems > MAX_COPY_MESSAGES) {
      throw ConversationTooLargeError;
    }

    return response.items.map((record) => {
      const plaintext = this._crypto.openSealedBox(
        Base64.toUint8Array(record.data),
        source.keyPair,
      );
      const payload = JSON.parse(new TextDecoder().decode(plaintext)) as Record<
        string,
        unknown
      >;

      // v1: attachments fail closed — re-sealing attachment keys is deferred.
      const attachments = payload['attachments'];
      if (Array.isArray(attachments) && attachments.length > 0) {
        throw CannotDuplicateAttachmentsError;
      }

      return { record, payload };
    });
  }

  private async loadAndDecryptRedaction(
    conversationId: string,
    userKeyPair: KeyPair,
  ): Promise<DecryptedRedaction | null> {
    let keyResponse;
    try {
      keyResponse = await firstValueFrom(this._api.getRedactionKey(conversationId));
    } catch (err) {
      if (isNotFound(err)) {
        return null; // No redaction on this conversation — nothing to copy.
      }
      throw err;
    }

    // Unwrap the source redaction secret with the user's personal key, exactly
    // as RedactionService does (the secret is sealed to the user, not the
    // conversation, so holding the conversation key alone never unlocks it).
    const sourceRedactionKeyPair: KeyPair = {
      publicKey: Base64.toUint8Array(keyResponse.public_key),
      secretKey: this._crypto.openSealedBox(
        Base64.toUint8Array(keyResponse.wrapped_secret_key),
        userKeyPair,
      ),
    };

    const entriesResponse = await firstValueFrom(
      this._api.listRedactionEntries(conversationId),
    );

    const entries: DecryptedRedactionEntry[] = entriesResponse.items.map((item) => {
      // Decrypt to opaque plaintext; we re-seal the same bytes to the duplicate
      // redaction key, so this never has to understand the entry's shape. A
      // failure here means we'd lose PII hydration — fail closed.
      let plaintext: Uint8Array;
      try {
        plaintext = this._crypto.openSealedBox(
          Base64.toUint8Array(item.data),
          sourceRedactionKeyPair,
        );
      } catch {
        throw RedactionCopyError;
      }
      return {
        token: item.token,
        sourceKind: item.source_kind,
        sourceId: item.source_id,
        plaintext,
      };
    });

    return { entries };
  }

  // buildAndPost mints fresh ids + a fresh keypair, re-encrypts everything, and
  // POSTs. It is idempotent to call again (the safe 409 retry unit).
  private async buildAndPost(
    source: Conversation,
    sourceMessages: DecryptedSourceMessage[],
    redaction: DecryptedRedaction | null,
    title: string,
    userKeyPair: KeyPair,
  ): Promise<{ record: ConversationRecord; keyPair: KeyPair }> {
    // One distinct id per message plus the conversation, so nothing in the
    // bundle can collide with itself.
    const ids = uniqueClientIds(sourceMessages.length + 1);
    const conversationId = ids[0];
    const messageIds = ids.slice(1);

    const idMap = new Map<string, string>();
    sourceMessages.forEach((m, i) => idMap.set(m.record.id, messageIds[i]));

    const duplicateKeyPair = this._crypto.newKeyPair();

    const messages: ApiCopyMessageInput[] = sourceMessages.map((m, i) => {
      const payload = { ...m.payload };
      payload['conversation_id'] = conversationId;
      const sourceParent = m.record.parent_message;
      payload['parent_message_id'] = sourceParent
        ? (idMap.get(sourceParent) ?? '')
        : '';

      const data = this._crypto.createSealedBox(
        encodeUtf8(JSON.stringify(payload)),
        duplicateKeyPair.publicKey,
      );

      return {
        id: messageIds[i],
        source_id: m.record.id,
        data: Base64.fromUint8Array(data),
      };
    });

    const keyMaterial = this._conversations.buildNewConversationKeyMaterial(
      conversationId,
      ConversationData.parse({ title }),
      duplicateKeyPair,
    );

    const request: ApiCopyConversationRequest = {
      conversation: {
        id: conversationId,
        ...keyMaterial,
        expiry_duration: source.record.expiry_duration ?? '',
      },
      messages,
    };

    if (redaction) {
      request.redaction = this.buildRedactionInput(redaction, idMap, userKeyPair);
    }

    const response = await firstValueFrom(
      this._api.copyConversation(source.record.id, request),
    );

    // The response carries the full duplicate record — use it directly.
    const record: ConversationRecord = {
      id: response.conversation.id,
      created: response.conversation.created,
      updated: response.conversation.updated,
      last_activity_at: response.conversation.last_activity_at,
      data: response.conversation.data,
      creator: response.conversation.creator,
      expiry_duration: response.conversation.expiry_duration,
    };

    return { record, keyPair: duplicateKeyPair };
  }

  private buildRedactionInput(
    redaction: DecryptedRedaction,
    idMap: Map<string, string>,
    userKeyPair: KeyPair,
  ): ApiCopyRedactionInput {
    const duplicateRedactionKeyPair = this._crypto.newKeyPair();

    const entries: ApiRedactionEntry[] = redaction.entries.map((entry) => {
      let sourceId = entry.sourceId;
      if (entry.sourceKind === 'message') {
        const mapped = idMap.get(entry.sourceId);
        if (!mapped) {
          // The entry anchors to a message that isn't in the copy set — we
          // would orphan it. Fail closed rather than lose hydration.
          throw RedactionCopyError;
        }
        sourceId = mapped;
      }

      return {
        token: entry.token,
        data: Base64.fromUint8Array(
          this._crypto.createSealedBox(
            entry.plaintext,
            duplicateRedactionKeyPair.publicKey,
          ),
        ),
        source_kind: entry.sourceKind,
        source_id: sourceId,
      };
    });

    return {
      // Wrap the duplicate redaction secret for the copying user only (v1:
      // standalone, single reader).
      public_key: Base64.fromUint8Array(duplicateRedactionKeyPair.publicKey),
      wrapped_secret_key: Base64.fromUint8Array(
        this._crypto.createSealedBox(
          duplicateRedactionKeyPair.secretKey,
          userKeyPair.publicKey,
        ),
      ),
      entries,
    };
  }
}

// encodeUtf8 coerces TextEncoder output into the current realm's Uint8Array.
// tweetnacl rejects typed arrays from another realm (jsdom/TextEncoder hands
// back its own constructor under test), so callers normalise before sealing —
// mirrors redaction.service.ts. A no-op cost in a real single-realm browser.
function encodeUtf8(value: string): Uint8Array {
  return Uint8Array.from(new TextEncoder().encode(value));
}

function isConflict(err: unknown): boolean {
  return (err as { status?: number } | null)?.status === 409;
}

function isNotFound(err: unknown): boolean {
  return (err as { status?: number } | null)?.status === 404;
}
