import { TestBed } from '@angular/core/testing';

import { Observable, of, throwError } from 'rxjs';

import { Base64 } from 'js-base64';
import { beforeEach, describe, expect, it } from 'vitest';

import { Conversation } from '@app/interfaces/conversation';
import { KeyPair } from '@app/interfaces/key-pair';

import {
  ApiCopyConversationRequest,
  ApiCopyConversationResponse,
  ApiListRedactionEntriesResponse,
  ApiRedactionKeyResponse,
  CognosApiService,
  MessageListResponse,
  MessageRecord,
} from './cognos-api.service';
import {
  CannotDuplicateAttachmentsError,
  CannotDuplicateProjectError,
  ConversationCopyService,
  ConversationTooLargeError,
} from './conversation-copy.service';
import { ConversationService } from './conversation.service';
import { CryptoService } from './crypto.service';
import { VaultService } from './vault.service';

// ─────────────────────────────────────────────────────────────────────────
// These tests exercise the copy service's own crypto with a REAL CryptoService:
// it decrypts seeded source messages, re-seals them to a fresh keypair, and
// remaps the graph. ConversationService.buildNewConversationKeyMaterial is
// faked — it reuses ConversationService's own (loader-shared) private methods,
// so its format is guaranteed by construction and proven end-to-end in the API
// e2e suite; here we only need it to return plausible material.
// ─────────────────────────────────────────────────────────────────────────

const crypto = new CryptoService();

// Coerce into this realm's Uint8Array — tweetnacl rejects TextEncoder output
// from jsdom's realm (same reason the services use a helper).
function bytes(value: string): Uint8Array {
  return Uint8Array.from(new TextEncoder().encode(value));
}

interface SeededMessage {
  id: string;
  parent?: string;
  content: string;
}

class FakeApi {
  sourceConversationId = 'srcconv00000001';
  messages: MessageRecord[] = [];
  totalItemsOverride: number | null = null;

  redactionKey: ApiRedactionKeyResponse | null = null;
  redactionEntries: ApiListRedactionEntriesResponse['items'] = [];

  copyRequests: ApiCopyConversationRequest[] = [];
  // Status codes to throw on successive copyConversation calls before
  // succeeding (used to simulate a 409 conflict then success).
  copyFailures: number[] = [];

  listConversationMessages(
    _id: string,
    page: number,
    size: number,
  ): Observable<MessageListResponse> {
    // Paginate like the real endpoint (which caps page_size at 100) so the
    // copy service's multi-page fetch is genuinely exercised.
    const totalItems = this.totalItemsOverride ?? this.messages.length;
    const start = (page - 1) * size;
    const items = this.messages.slice(start, start + size);
    return of({
      page,
      perPage: size,
      totalItems,
      totalPages: size > 0 ? Math.ceil(totalItems / size) : 0,
      items,
    });
  }

  getRedactionKey(): Observable<ApiRedactionKeyResponse> {
    return this.redactionKey
      ? of(this.redactionKey)
      : throwError(() => ({ status: 404 }));
  }

  listRedactionEntries(): Observable<ApiListRedactionEntriesResponse> {
    return of({ items: this.redactionEntries });
  }

  copyConversation(
    _sourceId: string,
    request: ApiCopyConversationRequest,
  ): Observable<ApiCopyConversationResponse> {
    this.copyRequests.push(request);
    const status = this.copyFailures.shift();
    if (status) {
      return throwError(() => ({ status }));
    }
    return of({
      conversation: {
        id: request.conversation.id,
        created: '2026-06-24 00:00:00.000Z',
        updated: '2026-06-24 00:00:00.000Z',
        data: request.conversation.data,
        key_version: 1,
        last_activity_at: '2026-06-24 00:00:00.000Z',
      },
      message_count: request.messages.length,
    });
  }
}

class FakeConversationService {
  upserted: Conversation[][] = [];

  buildNewConversationKeyMaterial(
    _id: string,
    _data: { title: string },
    keyPair: KeyPair,
  ) {
    // Plausible, non-plaintext material. The real implementation's format is
    // covered by the e2e suite + reuse of loader-shared private methods.
    return {
      data: Base64.fromUint8Array(crypto.randomKey()),
      public_key: Base64.fromUint8Array(keyPair.publicKey),
      public_key_signature: Base64.fromUint8Array(crypto.randomKey()),
      wrapped_secret_key: Base64.fromUint8Array(crypto.randomKey()),
    };
  }

  upsertConversations(conversations: Conversation[]): void {
    this.upserted.push(conversations);
  }
}

let api: FakeApi;
let userKeyPair: KeyPair;
let sourceKeyPair: KeyPair;
let service: ConversationCopyService;
let conversations: FakeConversationService;

function makeSource(opts?: { project?: string; title?: string }): Conversation {
  return {
    record: {
      id: api.sourceConversationId,
      created: '',
      updated: '',
      data: '',
      project: opts?.project,
    },
    decryptedData: { title: opts?.title ?? 'Source' },
    keyPair: sourceKeyPair,
  };
}

// seedMessages seals each message to the source conversation key, the same way
// the backend does, and registers them with the fake API.
function seedMessages(
  messages: SeededMessage[],
  extra?: Record<string, unknown>,
): void {
  api.messages = messages.map((m) => {
    const payload = {
      content: m.content,
      conversation_id: api.sourceConversationId,
      parent_message_id: m.parent ?? '',
      created_at: '2026-06-24T00:00:00Z',
      ...extra,
    };
    return {
      id: m.id,
      created: '',
      updated: '',
      conversation: api.sourceConversationId,
      parent_message: m.parent ?? '',
      data: Base64.fromUint8Array(
        crypto.createSealedBox(bytes(JSON.stringify(payload)), sourceKeyPair.publicKey),
      ),
    } satisfies MessageRecord;
  });
}

function decryptDup(dataB64: string, keyPair: KeyPair): Record<string, unknown> {
  return JSON.parse(
    new TextDecoder().decode(
      crypto.openSealedBox(Base64.toUint8Array(dataB64), keyPair),
    ),
  );
}

beforeEach(() => {
  api = new FakeApi();
  userKeyPair = crypto.newKeyPair();
  sourceKeyPair = crypto.newKeyPair();
  conversations = new FakeConversationService();

  TestBed.configureTestingModule({
    providers: [
      ConversationCopyService,
      CryptoService,
      { provide: CognosApiService, useValue: api },
      { provide: ConversationService, useValue: conversations },
      { provide: VaultService, useValue: { keyPair: () => userKeyPair } },
    ],
  });
  service = TestBed.inject(ConversationCopyService);
});

describe('ConversationCopyService — standalone happy path', () => {
  it('copies a branched tree, remapping parents to duplicate ids', async () => {
    seedMessages([
      { id: 'srcmsg000000001', content: 'root question' },
      { id: 'srcmsg000000002', parent: 'srcmsg000000001', content: 'answer A' },
      { id: 'srcmsg000000003', parent: 'srcmsg000000001', content: 'answer B' },
    ]);

    const duplicate = await service.duplicate(makeSource(), 'Source (copy)');
    const request = api.copyRequests[0];

    expect(request.messages).toHaveLength(3);
    // Every duplicate id is fresh, distinct, and well-formed.
    const dupIds = request.messages.map((m) => m.id);
    expect(new Set(dupIds).size).toBe(3);
    for (const id of dupIds) {
      expect(id).toMatch(/^[a-z0-9]{15}$/);
    }

    // Build the source→dup map from source_id, then assert the tree shape was
    // preserved against the DECRYPTED parent bindings.
    const bySource = new Map(request.messages.map((m) => [m.source_id, m]));
    const dupRoot = bySource.get('srcmsg000000001')!;
    const dupA = bySource.get('srcmsg000000002')!;
    const dupB = bySource.get('srcmsg000000003')!;

    const rootPayload = decryptDup(dupRoot.data, duplicate.keyPair);
    const aPayload = decryptDup(dupA.data, duplicate.keyPair);
    const bPayload = decryptDup(dupB.data, duplicate.keyPair);

    expect(rootPayload['parent_message_id']).toBe('');
    expect(aPayload['parent_message_id']).toBe(dupRoot.id);
    expect(bPayload['parent_message_id']).toBe(dupRoot.id);

    // Every payload is rebound to the duplicate conversation and content is
    // preserved.
    for (const p of [rootPayload, aPayload, bPayload]) {
      expect(p['conversation_id']).toBe(request.conversation.id);
    }
    expect(rootPayload['content']).toBe('root question');

    // The duplicate was inserted into the store.
    expect(conversations.upserted[0][0].record.id).toBe(request.conversation.id);
    expect(duplicate.decryptedData.title).toBe('Source (copy)');
  });

  it('seals duplicates to the duplicate key — the source key cannot open them', async () => {
    seedMessages([{ id: 'srcmsg000000001', content: 'secret answer' }]);

    const duplicate = await service.duplicate(makeSource());
    const data = api.copyRequests[0].messages[0].data;

    // Opens with the duplicate key…
    expect(decryptDup(data, duplicate.keyPair)['content']).toBe('secret answer');
    // …and never with the stale source key.
    expect(() =>
      crypto.openSealedBox(Base64.toUint8Array(data), sourceKeyPair),
    ).toThrow();
  });

  it('walks every page so conversations larger than one page (100) copy fully', async () => {
    // 150 messages spans two pages at the endpoint's 100 cap. A single-page
    // fetch would silently truncate to 100 and the backend would reject the
    // count mismatch — so the service must paginate.
    const seeded: SeededMessage[] = Array.from({ length: 150 }, (_, i) => ({
      id: `srcmsg${String(i).padStart(9, '0')}`,
      content: `message ${i}`,
    }));
    seedMessages(seeded);

    await service.duplicate(makeSource());
    const request = api.copyRequests[0];

    expect(request.messages).toHaveLength(150);
    const copiedSources = new Set(request.messages.map((m) => m.source_id));
    for (const m of seeded) {
      expect(copiedSources.has(m.id)).toBe(true);
    }
    // All duplicate ids are still distinct across the whole (multi-page) set.
    expect(new Set(request.messages.map((m) => m.id)).size).toBe(150);
  });

  it('never puts plaintext message content in the request', async () => {
    seedMessages([{ id: 'srcmsg000000001', content: 'PLAINTEXT_NEEDLE_42' }]);

    await service.duplicate(makeSource());

    expect(JSON.stringify(api.copyRequests[0])).not.toContain('PLAINTEXT_NEEDLE_42');
  });
});

describe('ConversationCopyService — fail closed', () => {
  it('refuses project conversations before any work', async () => {
    await expect(
      service.duplicate(makeSource({ project: 'proj0000000001' })),
    ).rejects.toBe(CannotDuplicateProjectError);
    expect(api.copyRequests).toHaveLength(0);
  });

  it('refuses conversations containing attachments', async () => {
    seedMessages([{ id: 'srcmsg000000001', content: 'has image' }], {
      attachments: [{ id: 'att1', sealed_key: 'k', mime_type: 'image/png' }],
    });

    await expect(service.duplicate(makeSource())).rejects.toBe(
      CannotDuplicateAttachmentsError,
    );
    expect(api.copyRequests).toHaveLength(0);
  });

  it('refuses conversations over the message cap', async () => {
    seedMessages([{ id: 'srcmsg000000001', content: 'x' }]);
    api.totalItemsOverride = 501;

    await expect(service.duplicate(makeSource())).rejects.toBe(
      ConversationTooLargeError,
    );
    expect(api.copyRequests).toHaveLength(0);
  });
});

describe('ConversationCopyService — PII redaction', () => {
  it('re-seals entries under a fresh redaction key and remaps message source ids', async () => {
    seedMessages([{ id: 'srcmsg000000001', content: 'email [[PII_EMAIL_X]]' }]);

    // Seed the source redaction key (sealed to the user) + one entry sealed to
    // the source redaction public key, anchored to the source message.
    const sourceRedactionKeyPair = crypto.newKeyPair();
    const original = 'jane@example.com';
    api.redactionKey = {
      public_key: Base64.fromUint8Array(sourceRedactionKeyPair.publicKey),
      wrapped_secret_key: Base64.fromUint8Array(
        crypto.createSealedBox(sourceRedactionKeyPair.secretKey, userKeyPair.publicKey),
      ),
      key_version: 1,
    };
    api.redactionEntries = [
      {
        token: '[[PII_EMAIL_X]]',
        data: Base64.fromUint8Array(
          crypto.createSealedBox(
            bytes(JSON.stringify({ token: '[[PII_EMAIL_X]]', original, type: 'auto' })),
            sourceRedactionKeyPair.publicKey,
          ),
        ),
        key_version: 1,
        source_kind: 'message',
        source_id: 'srcmsg000000001',
      },
    ];

    await service.duplicate(makeSource());
    const request = api.copyRequests[0];

    expect(request.redaction).toBeDefined();
    const redaction = request.redaction!;
    // Fresh redaction public key.
    expect(redaction.public_key).not.toBe(api.redactionKey.public_key);
    expect(redaction.entries).toHaveLength(1);

    const entry = redaction.entries[0];
    // source_id was remapped to the duplicate message id.
    expect(entry.source_id).toBe(request.messages[0].id);
    expect(entry.token).toBe('[[PII_EMAIL_X]]');

    // Recover the duplicate redaction keypair from the wrapped secret (sealed
    // to the user) and decrypt the entry back to the original.
    const dupRedactionKeyPair: KeyPair = {
      publicKey: Base64.toUint8Array(redaction.public_key),
      secretKey: crypto.openSealedBox(
        Base64.toUint8Array(redaction.wrapped_secret_key),
        userKeyPair,
      ),
    };
    const decrypted = JSON.parse(
      new TextDecoder().decode(
        crypto.openSealedBox(Base64.toUint8Array(entry.data), dupRedactionKeyPair),
      ),
    ) as { original: string };
    expect(decrypted.original).toBe(original);

    // The stale source redaction key must NOT open the duplicate entry.
    expect(() =>
      crypto.openSealedBox(Base64.toUint8Array(entry.data), sourceRedactionKeyPair),
    ).toThrow();
  });

  it('copies cleanly when the source has no redaction (404)', async () => {
    seedMessages([{ id: 'srcmsg000000001', content: 'no pii' }]);
    // redactionKey stays null → getRedactionKey 404s.

    await service.duplicate(makeSource());
    expect(api.copyRequests[0].redaction).toBeUndefined();
  });
});

describe('ConversationCopyService — id conflict retry', () => {
  it('regenerates the whole bundle and retries once on 409', async () => {
    seedMessages([
      { id: 'srcmsg000000001', content: 'root' },
      { id: 'srcmsg000000002', parent: 'srcmsg000000001', content: 'child' },
    ]);
    api.copyFailures = [409]; // first attempt conflicts, second succeeds

    const duplicate = await service.duplicate(makeSource());

    expect(api.copyRequests).toHaveLength(2);
    const [first, second] = api.copyRequests;

    // The retry minted a brand-new conversation id and message ids — never a
    // patch of the conflicting one.
    expect(second.conversation.id).not.toBe(first.conversation.id);
    const firstMsgIds = new Set(first.messages.map((m) => m.id));
    for (const m of second.messages) {
      expect(firstMsgIds.has(m.id)).toBe(false);
    }
    // The successful (second) bundle is the one adopted.
    expect(duplicate.record.id).toBe(second.conversation.id);
  });

  it('propagates a non-conflict error without retrying', async () => {
    seedMessages([{ id: 'srcmsg000000001', content: 'x' }]);
    api.copyFailures = [500];

    await expect(service.duplicate(makeSource())).rejects.toMatchObject({
      status: 500,
    });
    expect(api.copyRequests).toHaveLength(1);
  });
});
