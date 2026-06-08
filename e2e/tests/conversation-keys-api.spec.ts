import { expect, test } from '@playwright/test';
import { randomBytes } from 'node:crypto';

import { newAnonymousApi, provisionApiUser } from './api-helpers';

interface ConversationCreateResponse {
  id: string;
  key_version: number;
}

interface ConversationPublicKeyResponse {
  id: string;
  conversation: string;
  public_key: string;
  public_key_signature?: string;
  key_version: number;
}

interface ConversationSecretKeyResponse {
  id: string;
  conversation: string;
  user: string;
  secret_key: string;
  key_version: number;
}

const CONVERSATION_DATA = Buffer.from(
  JSON.stringify({ title: 'key endpoints' }),
).toString('base64');

function randomBase64(bytes: number): string {
  return randomBytes(bytes).toString('base64');
}

async function createConversation(
  user: Awaited<ReturnType<typeof provisionApiUser>>,
): Promise<string> {
  const res = await user.api.post('/api/v1/conversations', {
    data: { data: CONVERSATION_DATA, expiry_duration: '' },
  });
  expect(res.ok(), `conv: ${res.status()} ${await res.text()}`).toBe(true);
  const body = (await res.json()) as ConversationCreateResponse;
  return body.id;
}

test.describe('conversation public-key API', () => {
  test('auth gate covers every public-key route', async () => {
    const api = await newAnonymousApi();
    try {
      expect(
        (await api.get('/api/v1/conversations/anyconv00000001/public-key')).status(),
      ).toBe(401);
      expect(
        (
          await api.post('/api/v1/conversations/anyconv00000001/public-key', {
            data: { public_key: randomBase64(32) },
          })
        ).status(),
      ).toBe(401);
      expect(
        (
          await api.patch(
            '/api/v1/conversations/anyconv00000001/public-key/anykeyid000001',
            { data: { public_key_signature: randomBase64(32) } },
          )
        ).status(),
      ).toBe(401);
    } finally {
      await api.dispose();
    }
  });

  test('POST then GET round-trips the public key at key_version 1', async () => {
    const user = await provisionApiUser();
    try {
      const conversationID = await createConversation(user);
      const body = {
        public_key: randomBase64(32),
        public_key_signature: randomBase64(32),
      };

      const post = await user.api.post(
        `/api/v1/conversations/${conversationID}/public-key`,
        { data: body },
      );
      expect(post.status()).toBe(201);
      const posted = (await post.json()) as ConversationPublicKeyResponse;
      expect(posted.conversation).toBe(conversationID);
      expect(posted.public_key).toBe(body.public_key);
      expect(posted.public_key_signature).toBe(body.public_key_signature);
      expect(posted.key_version).toBe(1);

      const get = await user.api.get(
        `/api/v1/conversations/${conversationID}/public-key`,
      );
      expect(get.ok()).toBe(true);
      const fetched = (await get.json()) as ConversationPublicKeyResponse;
      expect(fetched.id).toBe(posted.id);
      expect(fetched.public_key).toBe(body.public_key);
      expect(fetched.key_version).toBe(1);
    } finally {
      await user.api.dispose();
    }
  });

  test('POST rejects a second public key for the same conversation', async () => {
    // The PocketBase create hook enforces "one public_key row per
    // conversation via this endpoint" — rotation is the only path that
    // legitimately layers additional generations on top.
    const user = await provisionApiUser();
    try {
      const conversationID = await createConversation(user);
      const first = await user.api.post(
        `/api/v1/conversations/${conversationID}/public-key`,
        { data: { public_key: randomBase64(32) } },
      );
      expect(first.ok()).toBe(true);

      const second = await user.api.post(
        `/api/v1/conversations/${conversationID}/public-key`,
        { data: { public_key: randomBase64(32) } },
      );
      expect(second.ok()).toBe(false);
      expect(second.status()).toBeGreaterThanOrEqual(400);
    } finally {
      await user.api.dispose();
    }
  });

  test('GET 404s for non-participants', async () => {
    const owner = await provisionApiUser();
    const outsider = await provisionApiUser();
    try {
      const conversationID = await createConversation(owner);
      await owner.api.post(`/api/v1/conversations/${conversationID}/public-key`, {
        data: { public_key: randomBase64(32) },
      });

      const get = await outsider.api.get(
        `/api/v1/conversations/${conversationID}/public-key`,
      );
      expect(get.status()).toBe(404);
    } finally {
      await owner.api.dispose();
      await outsider.api.dispose();
    }
  });

  test('PATCH /public-key/{id} can attach a signature retroactively', async () => {
    // The PATCH path takes a specific public_keys row id (not the
    // current generation) — used for attaching a signature to an
    // existing key without rotating. Pin that contract here.
    const user = await provisionApiUser();
    try {
      const conversationID = await createConversation(user);
      const post = await user.api.post(
        `/api/v1/conversations/${conversationID}/public-key`,
        {
          data: {
            public_key: randomBase64(32),
            public_key_signature: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=',
          },
        },
      );
      const { id: publicKeyID } = (await post.json()) as ConversationPublicKeyResponse;

      const newSignature = randomBase64(32);
      const patch = await user.api.patch(
        `/api/v1/conversations/${conversationID}/public-key/${publicKeyID}`,
        { data: { public_key_signature: newSignature } },
      );
      expect(patch.ok(), `patch: ${patch.status()} ${await patch.text()}`).toBe(true);
      const patched = (await patch.json()) as ConversationPublicKeyResponse;
      expect(patched.public_key_signature).toBe(newSignature);
    } finally {
      await user.api.dispose();
    }
  });
});

test.describe('conversation secret-key API', () => {
  test('auth gate covers both secret-key routes', async () => {
    const api = await newAnonymousApi();
    try {
      expect(
        (await api.get('/api/v1/conversations/anyconv00000001/secret-key')).status(),
      ).toBe(401);
      expect(
        (
          await api.post('/api/v1/conversations/anyconv00000001/secret-key', {
            data: { secret_key: randomBase64(64) },
          })
        ).status(),
      ).toBe(401);
    } finally {
      await api.dispose();
    }
  });

  test('POST then GET round-trips the wrapped secret key at key_version 1', async () => {
    const user = await provisionApiUser();
    try {
      const conversationID = await createConversation(user);

      const wrappedKey = randomBase64(64);
      const post = await user.api.post(
        `/api/v1/conversations/${conversationID}/secret-key`,
        { data: { secret_key: wrappedKey } },
      );
      expect(post.status()).toBe(201);
      const posted = (await post.json()) as ConversationSecretKeyResponse;
      expect(posted.conversation).toBe(conversationID);
      expect(posted.user).toBe(user.userId);
      expect(posted.secret_key).toBe(wrappedKey);
      expect(posted.key_version).toBe(1);

      const get = await user.api.get(
        `/api/v1/conversations/${conversationID}/secret-key`,
      );
      expect(get.ok()).toBe(true);
      const fetched = (await get.json()) as ConversationSecretKeyResponse;
      expect(fetched.secret_key).toBe(wrappedKey);
      expect(fetched.key_version).toBe(1);
    } finally {
      await user.api.dispose();
    }
  });

  test('GET 404s for non-participants — even when the row exists', async () => {
    const owner = await provisionApiUser();
    const outsider = await provisionApiUser();
    try {
      const conversationID = await createConversation(owner);
      await owner.api.post(`/api/v1/conversations/${conversationID}/secret-key`, {
        data: { secret_key: randomBase64(64) },
      });

      // Outsider has never been added as a participant; the lookup
      // must 404 with the same shape as a missing conversation so the
      // endpoint cannot be used to probe for conversation ids.
      const get = await outsider.api.get(
        `/api/v1/conversations/${conversationID}/secret-key`,
      );
      expect(get.status()).toBe(404);
    } finally {
      await owner.api.dispose();
      await outsider.api.dispose();
    }
  });

  test('POST rejects empty secret_key', async () => {
    const user = await provisionApiUser();
    try {
      const conversationID = await createConversation(user);
      const res = await user.api.post(
        `/api/v1/conversations/${conversationID}/secret-key`,
        { data: { secret_key: '' } },
      );
      expect(res.status()).toBe(400);
    } finally {
      await user.api.dispose();
    }
  });
});
