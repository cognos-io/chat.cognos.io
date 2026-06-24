import { expect, test } from '@playwright/test';
import { randomBytes } from 'node:crypto';

import { ProvisionedApiUser, newAnonymousApi, provisionApiUser } from './api-helpers';
import {
  KeyPairB64,
  authBox,
  generateKeyPair,
  openAuthBox,
  openSealed,
  sealFor,
  utf8,
} from './crypto-helpers';

// ─────────────────────────────────────────────────────────────────────────
// Conversation copy ("Duplicate chat") — full-stack contract.
//
// A duplicate is a NEW conversation with a FRESH keypair. Because every source
// message is a sealed box addressed to the SOURCE conversation public key, the
// browser must decrypt each payload, rewrite its conversation/parent bindings,
// and re-seal to the DUPLICATE public key before the backend stores it. These
// tests stand in for that browser, doing the same crypto with crypto-helpers,
// so the ciphertext the API receives is byte-identical to production.
//
// v1 scope (docs/specs/conversation-copy.md §0.0): standalone conversations
// only, PII redaction copied, attachments + project sources fail closed. The
// fail-closed / message-cap / rollback / graph-validation rejection paths are
// exercised in the Go backend test tables where rows can be inserted directly
// (much faster than seeding via the AI gateway) — see
// backend/cmd/api/conversation_copy_*_test.go.
// ─────────────────────────────────────────────────────────────────────────

const COPIES_PATH = (sourceID: string) => `/api/v1/conversations/${sourceID}/copies`;

const APPROVED_MODEL_ID = 'llama-3-3-infomaniak';
const DEFAULT_PERSONA_ID = 'cognos:simple-assistant';

interface ConversationResponse {
  id: string;
  key_version: number;
}

interface CopyResponse {
  conversation: {
    id: string;
    created: string;
    updated: string;
    data: string;
    key_version: number;
    last_activity_at: string;
  };
  message_count: number;
}

interface MessageListResponse {
  totalItems: number;
  items: {
    id: string;
    data: string;
    conversation: string;
    parent_message?: string;
  }[];
}

interface ParticipantListResponse {
  participants: { user_id: string; role: string }[];
}

interface RedactionKeyResponse {
  public_key: string;
  wrapped_secret_key: string;
  key_version: number;
}

interface RedactionEntriesResponse {
  items: { token: string; data: string; source_kind: string; source_id: string }[];
}

// 15-char lowercase-alphanumeric id — the production client uses nanoid with
// this alphabet/length so the value drops straight into PocketBase text id
// columns. The dedupe (caller side) is verified in the frontend unit tests;
// here we just need fresh, well-formed ids.
const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
function clientId(): string {
  const bytes = randomBytes(15);
  let out = '';
  for (let i = 0; i < 15; i++) out += ID_ALPHABET[bytes[i] % ID_ALPHABET.length];
  return out;
}

// createKeyedConversation seeds a real, decryptable conversation: conversation
// `data` is an authBox to its own keypair, the public key is stored so the
// server can seal messages to it, and the conversation secret is wrapped to the
// owner's user keypair exactly as the frontend does.
async function createKeyedConversation(
  owner: ProvisionedApiUser,
  ownerKeys: KeyPairB64,
  title: string,
): Promise<{ conversationId: string; conversationKeys: KeyPairB64 }> {
  const conversationKeys = generateKeyPair();

  const data = authBox(
    conversationKeys.publicKey,
    conversationKeys.secretKey,
    utf8.encode(JSON.stringify({ title })),
  );

  const createConv = await owner.api.post('/api/v1/conversations', {
    data: { data, expiry_duration: '' },
  });
  expect(
    createConv.ok(),
    `create conv: ${createConv.status()} ${await createConv.text()}`,
  ).toBe(true);
  const { id: conversationId } = (await createConv.json()) as ConversationResponse;

  const publicKeyRes = await owner.api.post(
    `/api/v1/conversations/${conversationId}/public-key`,
    {
      data: {
        public_key: conversationKeys.publicKey,
        public_key_signature: randomBytes(32).toString('base64'),
      },
    },
  );
  expect(publicKeyRes.ok(), `public-key: ${publicKeyRes.status()}`).toBe(true);

  const secretKeyRes = await owner.api.post(
    `/api/v1/conversations/${conversationId}/secret-key`,
    {
      data: {
        secret_key: authBox(
          conversationKeys.publicKey,
          ownerKeys.secretKey,
          Buffer.from(conversationKeys.secretKey, 'base64'),
        ),
      },
    },
  );
  expect(secretKeyRes.ok(), `secret-key: ${secretKeyRes.status()}`).toBe(true);

  return { conversationId, conversationKeys };
}

// seedCompletion drives one persisted completion. With regenerate=true and a
// parentMessageId it appends a SIBLING assistant branch under the same user
// message, which is how we build a branched source tree to copy.
async function seedCompletion(
  owner: ProvisionedApiUser,
  conversationId: string,
  userMessage: string,
  opts: { parentMessageId?: string; regenerate?: boolean; requestId: string },
): Promise<void> {
  const path = opts.regenerate ? 'regenerate' : 'complete';
  const res = await owner.api.post(`/api/v1/conversations/${conversationId}/${path}`, {
    data: {
      model_id: APPROVED_MODEL_ID,
      persona_id: DEFAULT_PERSONA_ID,
      system_prompt: 'You are a helpful test persona.',
      request_id: opts.requestId,
      parent_message_id: opts.parentMessageId ?? '',
      messages: [{ role: 'user', content: userMessage }],
    },
  });
  expect(res.ok(), `${path}: ${res.status()} ${await res.text()}`).toBe(true);
}

async function listMessages(
  user: ProvisionedApiUser,
  conversationId: string,
): Promise<MessageListResponse> {
  const res = await user.api.get(
    `/api/v1/conversations/${conversationId}/messages?page=1&page_size=200`,
  );
  expect(res.ok(), `messages: ${res.status()} ${await res.text()}`).toBe(true);
  return (await res.json()) as MessageListResponse;
}

interface PreparedCopy {
  body: Record<string, unknown>;
  duplicateKeys: KeyPairB64;
  duplicateConversationId: string;
  // source message id → duplicate message id
  idMap: Map<string, string>;
}

// prepareCopyBundle is the heart of the client work: decrypt every source
// message with the source keypair, generate the duplicate keypair + ids, rewrite
// the conversation/parent bindings inside each payload, and re-seal to the
// duplicate public key. Returns a ready-to-POST body plus the secrets a test
// needs to verify the result.
function prepareCopyBundle(
  callerKeys: KeyPairB64,
  sourceKeys: KeyPairB64,
  sourceMessages: MessageListResponse['items'],
  title: string,
  overrides?: { conversationId?: string; messageIds?: Record<string, string> },
): PreparedCopy {
  const duplicateKeys = generateKeyPair();
  const duplicateConversationId = overrides?.conversationId ?? clientId();

  // Pre-generate one duplicate id per source message so encrypted parent
  // pointers can be rewritten before anything is persisted.
  const idMap = new Map<string, string>();
  for (const m of sourceMessages) {
    idMap.set(m.id, overrides?.messageIds?.[m.id] ?? clientId());
  }

  const messages = sourceMessages.map((m) => {
    const plaintext = JSON.parse(utf8.decode(openSealed(sourceKeys, m.data))) as Record<
      string,
      unknown
    >;
    plaintext['conversation_id'] = duplicateConversationId;
    const dupParent = m.parent_message ? idMap.get(m.parent_message) : '';
    plaintext['parent_message_id'] = dupParent ?? '';

    return {
      id: idMap.get(m.id),
      source_id: m.id,
      data: sealFor(duplicateKeys.publicKey, utf8.encode(JSON.stringify(plaintext))),
    };
  });

  const body: Record<string, unknown> = {
    conversation: {
      id: duplicateConversationId,
      data: authBox(
        duplicateKeys.publicKey,
        duplicateKeys.secretKey,
        utf8.encode(JSON.stringify({ title })),
      ),
      public_key: duplicateKeys.publicKey,
      public_key_signature: randomBytes(32).toString('base64'),
      wrapped_secret_key: authBox(
        duplicateKeys.publicKey,
        callerKeys.secretKey,
        Buffer.from(duplicateKeys.secretKey, 'base64'),
      ),
      expiry_duration: '',
    },
    messages,
  };

  return { body, duplicateKeys, duplicateConversationId, idMap };
}

// Rebuild the duplicate conversation keypair from the wrapped secret the copy
// stored, proving the caller can read the duplicate the normal way.
async function recoverDuplicateKeys(
  caller: ProvisionedApiUser,
  callerKeys: KeyPairB64,
  duplicateConversationId: string,
): Promise<KeyPairB64> {
  const pub = await caller.api.get(
    `/api/v1/conversations/${duplicateConversationId}/public-key`,
  );
  expect(pub.ok(), `dup public-key: ${pub.status()}`).toBe(true);
  const publicKey = ((await pub.json()) as { public_key: string }).public_key;

  const sec = await caller.api.get(
    `/api/v1/conversations/${duplicateConversationId}/secret-key`,
  );
  expect(sec.ok(), `dup secret-key: ${sec.status()}`).toBe(true);
  const wrapped = ((await sec.json()) as { secret_key: string }).secret_key;

  const secretKey = Buffer.from(
    openAuthBox(publicKey, callerKeys.secretKey, wrapped),
  ).toString('base64');
  return { publicKey, secretKey };
}

test.describe('conversation copy API — auth', () => {
  test('unauthenticated copy is rejected', async () => {
    const api = await newAnonymousApi();
    try {
      const res = await api.post(COPIES_PATH('anyconvid000000'), {
        data: { conversation: {}, messages: [] },
      });
      expect(res.status()).toBe(401);
    } finally {
      await api.dispose();
    }
  });

  test('a non-participant gets 404 and no duplicate is created', async () => {
    const owner = await provisionApiUser();
    const ownerKeys = generateKeyPair();
    const outsider = await provisionApiUser();
    const outsiderKeys = generateKeyPair();

    try {
      const { conversationId, conversationKeys } = await createKeyedConversation(
        owner,
        ownerKeys,
        'Private source',
      );
      await seedCompletion(owner, conversationId, 'hello there', {
        requestId: 'copy-404-1',
      });

      // The outsider has no read access, so it can't legitimately have the
      // source ciphertext — but even a crafted bundle must be refused with the
      // same 404 a missing conversation returns (no existence oracle).
      const prepared = prepareCopyBundle(
        outsiderKeys,
        conversationKeys,
        [],
        'Stolen copy',
      );
      const res = await outsider.api.post(COPIES_PATH(conversationId), {
        data: prepared.body,
      });
      expect(res.status()).toBe(404);

      // The submitted duplicate id must not exist.
      const probe = await outsider.api.get(
        `/api/v1/conversations/${prepared.duplicateConversationId}/public-key`,
      );
      expect(probe.status()).toBe(404);
    } finally {
      await owner.api.dispose();
      await outsider.api.dispose();
    }
  });
});

test.describe('conversation copy API — standalone happy path', () => {
  test('duplicates a branched conversation: all messages copied, parents remapped, only caller is Admin', async () => {
    const owner = await provisionApiUser();
    const ownerKeys = generateKeyPair();

    try {
      const { conversationId, conversationKeys } = await createKeyedConversation(
        owner,
        ownerKeys,
        'Rabbit hole',
      );

      // Build a branched tree: one user message with two sibling assistant
      // replies (the regenerate path).
      await seedCompletion(owner, conversationId, 'Explain branch A', {
        requestId: 'copy-branch-1',
      });
      const afterFirst = await listMessages(owner, conversationId);
      const rootUserMessage = afterFirst.items.find((m) => !m.parent_message);
      expect(rootUserMessage, 'expected a root user message').toBeTruthy();
      await seedCompletion(owner, conversationId, 'Explain branch A', {
        requestId: 'copy-branch-2',
        parentMessageId: rootUserMessage!.id,
        regenerate: true,
      });

      const sourceMessages = (await listMessages(owner, conversationId)).items;
      // 1 user + 2 assistant siblings.
      expect(sourceMessages.length).toBe(3);

      const prepared = prepareCopyBundle(
        ownerKeys,
        conversationKeys,
        sourceMessages,
        'Rabbit hole (copy)',
      );

      const res = await owner.api.post(COPIES_PATH(conversationId), {
        data: prepared.body,
      });
      expect(res.status(), `copy: ${res.status()} ${await res.text()}`).toBe(201);
      const body = (await res.json()) as CopyResponse;
      expect(body.conversation.id).toBe(prepared.duplicateConversationId);
      expect(body.conversation.key_version).toBe(1);
      expect(body.message_count).toBe(3);

      // The duplicate is a distinct conversation.
      expect(body.conversation.id).not.toBe(conversationId);

      // Only the caller, as Admin.
      const partRes = await owner.api.get(
        `/api/v1/conversations/${prepared.duplicateConversationId}/participants`,
      );
      expect(partRes.ok()).toBe(true);
      const participants = (await partRes.json()) as ParticipantListResponse;
      // ListActive already filters to current members.
      expect(participants.participants.length).toBe(1);
      expect(participants.participants[0].user_id).toBe(owner.userId);
      expect(participants.participants[0].role).toBe('Admin');

      // The full tree copied, with parents remapped to duplicate ids.
      const dupMessages = (await listMessages(owner, prepared.duplicateConversationId))
        .items;
      expect(dupMessages.length).toBe(3);

      // Every duplicate message belongs to the duplicate conversation, and no
      // duplicate parent points at a source id.
      const dupIds = new Set(dupMessages.map((m) => m.id));
      const sourceIds = new Set(sourceMessages.map((m) => m.id));
      for (const m of dupMessages) {
        expect(m.conversation).toBe(prepared.duplicateConversationId);
        if (m.parent_message) {
          expect(dupIds.has(m.parent_message)).toBe(true);
          expect(sourceIds.has(m.parent_message)).toBe(false);
        }
      }
      // Exactly one root and two children, mirroring the source shape.
      const roots = dupMessages.filter((m) => !m.parent_message);
      expect(roots.length).toBe(1);
      const children = dupMessages.filter((m) => m.parent_message === roots[0].id);
      expect(children.length).toBe(2);
    } finally {
      await owner.api.dispose();
    }
  });

  test('duplicate payloads decrypt with the duplicate key and NOT the source key', async () => {
    const owner = await provisionApiUser();
    const ownerKeys = generateKeyPair();
    const userMessage = 'Decryptable only by the duplicate';

    try {
      const { conversationId, conversationKeys } = await createKeyedConversation(
        owner,
        ownerKeys,
        'Crypto isolation',
      );
      await seedCompletion(owner, conversationId, userMessage, {
        requestId: 'copy-crypto-1',
      });

      const sourceMessages = (await listMessages(owner, conversationId)).items;
      const prepared = prepareCopyBundle(
        ownerKeys,
        conversationKeys,
        sourceMessages,
        'Crypto isolation (copy)',
      );
      const res = await owner.api.post(COPIES_PATH(conversationId), {
        data: prepared.body,
      });
      expect(res.status()).toBe(201);

      const duplicateKeys = await recoverDuplicateKeys(
        owner,
        ownerKeys,
        prepared.duplicateConversationId,
      );
      const dupMessages = (await listMessages(owner, prepared.duplicateConversationId))
        .items;

      // The headline guarantee: duplicate ciphertext opens with the recovered
      // duplicate keypair, and the decrypted binding matches the duplicate row.
      const contents = dupMessages.map((m) => {
        const payload = JSON.parse(utf8.decode(openSealed(duplicateKeys, m.data))) as {
          content: string | null;
          conversation_id?: string;
        };
        expect(payload.conversation_id).toBe(prepared.duplicateConversationId);
        return payload.content;
      });
      expect(contents).toContain(userMessage);

      // And the stale source keypair must NOT open the duplicate ciphertext.
      for (const m of dupMessages) {
        expect(() => openSealed(conversationKeys, m.data)).toThrow();
      }
    } finally {
      await owner.api.dispose();
    }
  });

  test('inherits expiry_duration and a publicly shared source does not share the duplicate', async () => {
    const owner = await provisionApiUser();
    const ownerKeys = generateKeyPair();

    try {
      const { conversationId, conversationKeys } = await createKeyedConversation(
        owner,
        ownerKeys,
        'Shared source',
      );
      await seedCompletion(owner, conversationId, 'public please', {
        requestId: 'copy-share-1',
      });

      // Share the source publicly.
      const shareKeys = generateKeyPair();
      const share = await owner.api.post(
        `/api/v1/conversations/${conversationId}/public-share`,
        {
          data: {
            public_key: shareKeys.publicKey,
            wrapped_conversation_secret_key: sealFor(
              shareKeys.publicKey,
              Buffer.from(conversationKeys.secretKey, 'base64'),
            ),
            share_secret: sealFor(
              conversationKeys.publicKey,
              Buffer.from(shareKeys.secretKey, 'base64'),
            ),
          },
        },
      );
      expect(share.ok()).toBe(true);

      const sourceMessages = (await listMessages(owner, conversationId)).items;
      const prepared = prepareCopyBundle(
        ownerKeys,
        conversationKeys,
        sourceMessages,
        'Shared source (copy)',
      );
      const res = await owner.api.post(COPIES_PATH(conversationId), {
        data: prepared.body,
      });
      expect(res.status()).toBe(201);

      // The duplicate must start private — no share row.
      const dupShare = await owner.api.get(
        `/api/v1/conversations/${prepared.duplicateConversationId}/public-share`,
      );
      expect(dupShare.status()).toBe(404);
    } finally {
      await owner.api.dispose();
    }
  });
});

test.describe('conversation copy API — client-generated id conflicts', () => {
  test('a duplicate conversation id that already exists returns 409 and writes nothing', async () => {
    const owner = await provisionApiUser();
    const ownerKeys = generateKeyPair();

    try {
      const { conversationId, conversationKeys } = await createKeyedConversation(
        owner,
        ownerKeys,
        'Conflict source',
      );
      await seedCompletion(owner, conversationId, 'conflict', {
        requestId: 'copy-conflict-1',
      });
      const sourceMessages = (await listMessages(owner, conversationId)).items;

      // Occupy an id by creating another conversation, then reuse it.
      const other = await createKeyedConversation(owner, ownerKeys, 'Occupant');

      const prepared = prepareCopyBundle(
        ownerKeys,
        conversationKeys,
        sourceMessages,
        'Conflict (copy)',
        { conversationId: other.conversationId },
      );
      const res = await owner.api.post(COPIES_PATH(conversationId), {
        data: prepared.body,
      });
      expect(res.status()).toBe(409);

      // Nothing partial: the occupant conversation keeps its original messages
      // (none), proving the copy didn't write messages into it.
      const occupantMessages = await listMessages(owner, other.conversationId);
      expect(occupantMessages.totalItems).toBe(0);
    } finally {
      await owner.api.dispose();
    }
  });

  test('a duplicate message id that already exists returns 409 and writes nothing', async () => {
    const owner = await provisionApiUser();
    const ownerKeys = generateKeyPair();

    try {
      const { conversationId, conversationKeys } = await createKeyedConversation(
        owner,
        ownerKeys,
        'Msg conflict source',
      );
      await seedCompletion(owner, conversationId, 'msg conflict', {
        requestId: 'copy-msgconflict-1',
      });
      const sourceMessages = (await listMessages(owner, conversationId)).items;

      // Collide one duplicate message id with an existing message id.
      const collidingId = sourceMessages[0].id;
      const prepared = prepareCopyBundle(
        ownerKeys,
        conversationKeys,
        sourceMessages,
        'Msg conflict (copy)',
        { messageIds: { [sourceMessages[0].id]: collidingId } },
      );
      const res = await owner.api.post(COPIES_PATH(conversationId), {
        data: prepared.body,
      });
      expect(res.status()).toBe(409);

      // The duplicate conversation must not have been created.
      const probe = await owner.api.get(
        `/api/v1/conversations/${prepared.duplicateConversationId}/public-key`,
      );
      expect(probe.status()).toBe(404);
    } finally {
      await owner.api.dispose();
    }
  });
});

test.describe('conversation copy API — PII redaction', () => {
  test('copies redaction key + entries under a fresh redaction keypair, decryptable only by the duplicate redaction key', async () => {
    const owner = await provisionApiUser();
    const ownerKeys = generateKeyPair();
    const original = 'jane.doe@example.com';
    const token = '[[PII_EMAIL_ABC123]]';

    try {
      const { conversationId, conversationKeys } = await createKeyedConversation(
        owner,
        ownerKeys,
        'Redacted source',
      );
      await seedCompletion(owner, conversationId, `email me at ${token}`, {
        requestId: 'copy-redact-1',
      });
      const sourceMessages = (await listMessages(owner, conversationId)).items;
      const anchorMessageId = sourceMessages[0].id;

      // Seed the source redaction key + one entry, exactly as the frontend
      // redaction service does (secret sealed to the user's personal key; entry
      // sealed to the redaction public key).
      const sourceRedactionKeys = generateKeyPair();
      const keyRes = await owner.api.post(
        `/api/v1/conversations/${conversationId}/redaction-key`,
        {
          data: {
            public_key: sourceRedactionKeys.publicKey,
            keys: [
              {
                user_id: owner.userId,
                wrapped_secret_key: sealFor(
                  ownerKeys.publicKey,
                  Buffer.from(sourceRedactionKeys.secretKey, 'base64'),
                ),
              },
            ],
          },
        },
      );
      expect(keyRes.ok(), `redaction-key: ${keyRes.status()}`).toBe(true);

      const entryRes = await owner.api.post(
        `/api/v1/conversations/${conversationId}/redaction-entries`,
        {
          data: {
            entries: [
              {
                token,
                data: sealFor(
                  sourceRedactionKeys.publicKey,
                  utf8.encode(JSON.stringify({ token, original })),
                ),
                source_kind: 'message',
                source_id: anchorMessageId,
              },
            ],
          },
        },
      );
      expect(entryRes.ok(), `redaction-entries: ${entryRes.status()}`).toBe(true);

      // Prepare the message copy, then add the redaction block: a fresh
      // redaction keypair, the same token, the original re-sealed to the new
      // redaction public key, and source_id remapped to the duplicate message.
      const prepared = prepareCopyBundle(
        ownerKeys,
        conversationKeys,
        sourceMessages,
        'Redacted source (copy)',
      );
      const dupRedactionKeys = generateKeyPair();
      (prepared.body as { redaction?: unknown }).redaction = {
        public_key: dupRedactionKeys.publicKey,
        wrapped_secret_key: sealFor(
          ownerKeys.publicKey,
          Buffer.from(dupRedactionKeys.secretKey, 'base64'),
        ),
        entries: [
          {
            token,
            data: sealFor(
              dupRedactionKeys.publicKey,
              utf8.encode(JSON.stringify({ token, original })),
            ),
            source_kind: 'message',
            source_id: prepared.idMap.get(anchorMessageId),
          },
        ],
      };

      const res = await owner.api.post(COPIES_PATH(conversationId), {
        data: prepared.body,
      });
      expect(res.status(), `copy: ${res.status()} ${await res.text()}`).toBe(201);

      // The duplicate exposes its own redaction key, distinct from the source.
      const dupKeyRes = await owner.api.get(
        `/api/v1/conversations/${prepared.duplicateConversationId}/redaction-key`,
      );
      expect(dupKeyRes.ok()).toBe(true);
      const dupKey = (await dupKeyRes.json()) as RedactionKeyResponse;
      expect(dupKey.public_key).toBe(dupRedactionKeys.publicKey);
      expect(dupKey.public_key).not.toBe(sourceRedactionKeys.publicKey);

      // The entry copied, with source_id remapped to the duplicate message.
      const dupEntriesRes = await owner.api.get(
        `/api/v1/conversations/${prepared.duplicateConversationId}/redaction-entries`,
      );
      expect(dupEntriesRes.ok()).toBe(true);
      const dupEntries = (await dupEntriesRes.json()) as RedactionEntriesResponse;
      expect(dupEntries.items.length).toBe(1);
      const entry = dupEntries.items[0];
      expect(entry.token).toBe(token);
      expect(entry.source_id).toBe(prepared.idMap.get(anchorMessageId));

      // It decrypts with the DUPLICATE redaction key back to the original...
      const decrypted = JSON.parse(
        utf8.decode(openSealed(dupRedactionKeys, entry.data)),
      ) as { original: string };
      expect(decrypted.original).toBe(original);

      // ...and NOT with the stale source redaction key.
      expect(() => openSealed(sourceRedactionKeys, entry.data)).toThrow();
    } finally {
      await owner.api.dispose();
    }
  });
});
