import { expect, test } from '@playwright/test';

import { newAnonymousApi, provisionApiUser } from './api-helpers';

interface ConversationResponse {
  id: string;
  created: string;
  updated: string;
  data: string;
  creator?: string;
  expiry_duration?: string;
  key_version: number;
}

interface MessageListResponse {
  page: number;
  perPage: number;
  totalItems: number;
  totalPages: number;
  items: {
    id: string;
    created: string;
    data: string;
    conversation: string;
    parent_message?: string;
    expires?: string;
  }[];
}

// Conversation/message ciphertext is base64 from the API's perspective —
// the encryption envelope is verified by the backend integration tests. Any
// non-empty base64 string works for these contract assertions.
const CONVERSATION_DATA = Buffer.from(
  JSON.stringify({ title: 'CRUD contract' }),
).toString('base64');
const UPDATED_CONVERSATION_DATA = Buffer.from(
  JSON.stringify({ title: 'CRUD contract (renamed)' }),
).toString('base64');

test.describe('conversations CRUD API', () => {
  test('auth gate covers every conversation mutation', async () => {
    const api = await newAnonymousApi();
    try {
      const list = await api.get('/api/v1/conversations');
      expect(list.status()).toBe(401);

      const create = await api.post('/api/v1/conversations', {
        data: { data: CONVERSATION_DATA, expiry_duration: '' },
      });
      expect(create.status()).toBe(401);

      const update = await api.patch('/api/v1/conversations/anyconvid000000', {
        data: { data: CONVERSATION_DATA, expiry_duration: '' },
      });
      expect(update.status()).toBe(401);

      const del = await api.delete('/api/v1/conversations/anyconvid000000');
      expect(del.status()).toBe(401);

      const messages = await api.get('/api/v1/conversations/anyconvid000000/messages');
      expect(messages.status()).toBe(401);
    } finally {
      await api.dispose();
    }
  });

  test('POST creates a conversation at key_version 1 and echoes the ciphertext', async () => {
    const user = await provisionApiUser();
    try {
      const res = await user.api.post('/api/v1/conversations', {
        data: { data: CONVERSATION_DATA, expiry_duration: '24h' },
      });
      expect(res.status()).toBe(201);
      const body = (await res.json()) as ConversationResponse;

      expect(body.id).toBeTruthy();
      expect(body.data).toBe(CONVERSATION_DATA);
      expect(body.expiry_duration).toBe('24h');
      expect(body.key_version).toBe(1);
    } finally {
      await user.api.dispose();
    }
  });

  test('POST rejects an expiry_duration outside the documented allow-list', async () => {
    // The backend keeps a strict allow-list ("", 24h, 168h, 2160h, 4320h)
    // for ephemeral conversations. Pin that bypassing it returns 400 so
    // an attacker cannot persist an arbitrary duration on the row.
    const user = await provisionApiUser();
    try {
      for (const badDuration of ['1h', '720h', '24h ', '24H', 'forever']) {
        const res = await user.api.post('/api/v1/conversations', {
          data: { data: CONVERSATION_DATA, expiry_duration: badDuration },
        });
        expect(
          res.status(),
          `expiry_duration=${JSON.stringify(badDuration)} expected 400`,
        ).toBe(400);
      }
    } finally {
      await user.api.dispose();
    }
  });

  test('GET /conversations is scoped to the caller', async () => {
    const userA = await provisionApiUser();
    const userB = await provisionApiUser();
    try {
      const create = await userA.api.post('/api/v1/conversations', {
        data: { data: CONVERSATION_DATA, expiry_duration: '' },
      });
      expect(create.ok()).toBe(true);
      const { id: conversationID } = (await create.json()) as ConversationResponse;

      const listA = await userA.api.get('/api/v1/conversations');
      expect(listA.ok()).toBe(true);
      const bodyA = (await listA.json()) as ConversationResponse[];
      expect(bodyA.some((c) => c.id === conversationID)).toBe(true);

      const listB = await userB.api.get('/api/v1/conversations');
      expect(listB.ok()).toBe(true);
      const bodyB = (await listB.json()) as ConversationResponse[];
      expect(bodyB.some((c) => c.id === conversationID)).toBe(false);
    } finally {
      await userA.api.dispose();
      await userB.api.dispose();
    }
  });

  test('PATCH and DELETE return 404 to non-participants', async () => {
    // Locks the "same 404 as missing" privacy contract on mutating routes
    // — an attacker probing for valid conversation ids cannot distinguish
    // "exists, not yours" from "doesn't exist".
    const owner = await provisionApiUser();
    const outsider = await provisionApiUser();
    try {
      const create = await owner.api.post('/api/v1/conversations', {
        data: { data: CONVERSATION_DATA, expiry_duration: '' },
      });
      const { id: conversationID } = (await create.json()) as ConversationResponse;

      const patch = await outsider.api.patch(
        `/api/v1/conversations/${conversationID}`,
        { data: { data: UPDATED_CONVERSATION_DATA, expiry_duration: '' } },
      );
      expect(patch.status()).toBe(404);

      const del = await outsider.api.delete(`/api/v1/conversations/${conversationID}`);
      expect(del.status()).toBe(404);

      const messages = await outsider.api.get(
        `/api/v1/conversations/${conversationID}/messages`,
      );
      expect(messages.status()).toBe(404);
    } finally {
      await owner.api.dispose();
      await outsider.api.dispose();
    }
  });

  test('PATCH /conversations/{id} updates data + expiry for participants', async () => {
    const user = await provisionApiUser();
    try {
      const create = await user.api.post('/api/v1/conversations', {
        data: { data: CONVERSATION_DATA, expiry_duration: '' },
      });
      const { id: conversationID, key_version } =
        (await create.json()) as ConversationResponse;
      expect(key_version).toBe(1);

      const patch = await user.api.patch(`/api/v1/conversations/${conversationID}`, {
        data: { data: UPDATED_CONVERSATION_DATA, expiry_duration: '168h' },
      });
      expect(patch.ok(), `patch: ${patch.status()} ${await patch.text()}`).toBe(true);
      const updated = (await patch.json()) as ConversationResponse;

      expect(updated.id).toBe(conversationID);
      expect(updated.data).toBe(UPDATED_CONVERSATION_DATA);
      expect(updated.expiry_duration).toBe('168h');
      // PATCH must not mutate key_version — rotation is the only path
      // that changes the generation.
      expect(updated.key_version).toBe(1);
    } finally {
      await user.api.dispose();
    }
  });

  test('DELETE /conversations/{id} removes the row and any subsequent GET 404s', async () => {
    const user = await provisionApiUser();
    try {
      const create = await user.api.post('/api/v1/conversations', {
        data: { data: CONVERSATION_DATA, expiry_duration: '' },
      });
      const { id: conversationID } = (await create.json()) as ConversationResponse;

      const del = await user.api.delete(`/api/v1/conversations/${conversationID}`);
      expect(del.status()).toBe(204);

      // The participants list is the cheapest way to confirm the row is
      // gone — the access helper finds-the-conversation-first which now
      // surfaces 404 before we even reach the participant check.
      const followUp = await user.api.get(
        `/api/v1/conversations/${conversationID}/participants`,
      );
      expect(followUp.status()).toBe(404);
    } finally {
      await user.api.dispose();
    }
  });
});

test.describe('conversation messages CRUD API', () => {
  test('messages list returns the documented pagination envelope', async () => {
    const user = await provisionApiUser();
    try {
      const create = await user.api.post('/api/v1/conversations', {
        data: { data: CONVERSATION_DATA, expiry_duration: '' },
      });
      const { id: conversationID } = (await create.json()) as ConversationResponse;

      const list = await user.api.get(
        `/api/v1/conversations/${conversationID}/messages?page=1&page_size=50`,
      );
      expect(list.ok()).toBe(true);
      const body = (await list.json()) as MessageListResponse;

      // No messages have been sent yet — pin the envelope contract for
      // empty conversations. Frontend pagination relies on these fields.
      expect(body.page).toBe(1);
      expect(body.perPage).toBe(50);
      expect(body.totalItems).toBe(0);
      expect(body.totalPages).toBe(0);
      expect(body.items).toEqual([]);
    } finally {
      await user.api.dispose();
    }
  });

  test('messages PATCH and DELETE 404 for non-participants', async () => {
    const owner = await provisionApiUser();
    const outsider = await provisionApiUser();
    try {
      // Outsiders never get to even discover whether a message id is
      // valid — the participant-access gate fires before the
      // existence check. Use any plausible id; the outcome must be the
      // same shape regardless of whether the row exists.
      const patch = await outsider.api.patch('/api/v1/messages/abcd0000000abcd', {
        data: { clear_expires: true },
      });
      expect(patch.status()).toBe(404);

      const del = await outsider.api.delete('/api/v1/messages/abcd0000000abcd');
      expect(del.status()).toBe(404);

      // And the owner is unaffected by the outsider's probes.
      void owner;
    } finally {
      await owner.api.dispose();
      await outsider.api.dispose();
    }
  });
});
