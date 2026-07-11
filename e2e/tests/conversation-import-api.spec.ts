import { expect, test } from '@playwright/test';
import { randomBytes, randomUUID } from 'node:crypto';

import { newAnonymousApi, provisionApiUser } from './api-helpers';
import {
  authBox,
  generateKeyPair,
  openAuthBox,
  openSealed,
  sealFor,
  utf8,
} from './crypto-helpers';

const PATH = '/api/v1/conversation-imports';
const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';

function clientId(): string {
  const bytes = randomBytes(15);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

test.describe('conversation import API', () => {
  test('requires authentication', async () => {
    const api = await newAnonymousApi();
    try {
      const response = await api.post(PATH, { data: {} });
      expect(response.status()).toBe(401);
    } finally {
      await api.dispose();
    }
  });

  test('atomically stores only ciphertext, replays safely and denies another Account', async () => {
    const owner = await provisionApiUser();
    const outsider = await provisionApiUser();
    const ownerKeys = generateKeyPair();
    const conversationKeys = generateKeyPair();
    const conversationId = clientId();
    const firstId = clientId();
    const secondId = clientId();
    const rawMarker = 'SYNTHETIC-PRIVATE-IMPORT-MARKER-9f83c0';
    const body = {
      import_id: randomUUID().replaceAll('-', '_'),
      source: 'claude',
      conversation: {
        id: conversationId,
        data: authBox(
          conversationKeys.publicKey,
          conversationKeys.secretKey,
          utf8.encode(JSON.stringify({ title: 'Synthetic imported Conversation' })),
        ),
        public_key: conversationKeys.publicKey,
        public_key_signature: randomBytes(32).toString('base64'),
        wrapped_secret_key: authBox(
          conversationKeys.publicKey,
          ownerKeys.secretKey,
          Buffer.from(conversationKeys.secretKey, 'base64'),
        ),
        expiry_duration: '',
      },
      messages: [
        {
          id: firstId,
          data: sealFor(
            conversationKeys.publicKey,
            utf8.encode(
              JSON.stringify({
                version: '1',
                content: rawMarker,
                conversation_id: conversationId,
                parent_message_id: '',
                owner_id: owner.id,
              }),
            ),
          ),
        },
        {
          id: secondId,
          parent_message: firstId,
          data: sealFor(
            conversationKeys.publicKey,
            utf8.encode(
              JSON.stringify({
                version: '1',
                content: 'Synthetic assistant answer',
                conversation_id: conversationId,
                parent_message_id: firstId,
              }),
            ),
          ),
        },
      ],
    };

    expect(JSON.stringify(body)).not.toContain(rawMarker);
    try {
      const created = await owner.api.post(PATH, { data: body });
      expect(created.status()).toBe(201);
      expect(await created.json()).toMatchObject({ message_count: 2 });

      const replay = await owner.api.post(PATH, { data: body });
      expect(replay.status()).toBe(200);
      expect(await replay.json()).toMatchObject({ message_count: 2 });

      const conflictingReplay = await owner.api.post(PATH, {
        data: { ...body, source: 'chatgpt' },
      });
      expect(conflictingReplay.status()).toBe(409);

      const messages = await owner.api.get(
        `/api/v1/conversations/${conversationId}/messages?page=1&page_size=10`,
      );
      expect(messages.ok()).toBe(true);
      const records = (await messages.json()) as {
        items: { id: string; data: string }[];
      };
      expect(records.items).toHaveLength(2);
      const plaintext = records.items.map((record) =>
        JSON.parse(utf8.decode(openSealed(conversationKeys, record.data))),
      );
      expect(plaintext.map((message) => message.content)).toEqual([
        rawMarker,
        'Synthetic assistant answer',
      ]);

      const secretResponse = await owner.api.get(
        `/api/v1/conversations/${conversationId}/secret-key`,
      );
      expect(secretResponse.ok()).toBe(true);
      const wrapped = ((await secretResponse.json()) as { secret_key: string })
        .secret_key;
      expect(
        Buffer.from(
          openAuthBox(conversationKeys.publicKey, ownerKeys.secretKey, wrapped),
        ).toString('base64'),
      ).toBe(conversationKeys.secretKey);

      const denied = await outsider.api.get(
        `/api/v1/conversations/${conversationId}/messages`,
      );
      expect(denied.status()).toBe(404);
    } finally {
      await owner.api.dispose();
      await outsider.api.dispose();
    }
  });
});
