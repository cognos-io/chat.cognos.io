import { expect, test } from '@playwright/test';
import { randomBytes } from 'node:crypto';

import { newAnonymousApi, provisionApiUser } from './api-helpers';

// A bookmark's `data` is chat content sealed CLIENT-SIDE; the server stores only
// opaque base64. Here we round-trip an arbitrary base64 blob to prove the wire
// contract (owner-scoped CRUD + conversation-access gate + cross-user 404); the
// crypto itself is the client's job.
const sealed = (payload: unknown) =>
  Buffer.from(JSON.stringify(payload)).toString('base64');

type ApiUser = Awaited<ReturnType<typeof provisionApiUser>>;

interface BookmarkRecord {
  id: string;
  conversation: string;
  message: string;
  data: string;
}
interface BookmarkList {
  items: BookmarkRecord[];
}

const CONVERSATION_DATA = Buffer.from(
  JSON.stringify({ title: 'bookmark contract' }),
).toString('base64');

// Creates a conversation (with a public key) the user is an Admin participant of,
// so it is accessible for bookmark creation.
async function createConversation(user: ApiUser): Promise<string> {
  const res = await user.api.post('/api/v1/conversations', {
    data: { data: CONVERSATION_DATA, expiry_duration: '' },
  });
  expect(res.ok(), `conv: ${res.status()} ${await res.text()}`).toBe(true);
  const { id } = (await res.json()) as { id: string };

  const keyRes = await user.api.post(`/api/v1/conversations/${id}/public-key`, {
    data: {
      public_key: randomBytes(32).toString('base64'),
      public_key_signature: randomBytes(32).toString('base64'),
    },
  });
  expect(keyRes.ok(), `public-key: ${keyRes.status()}`).toBe(true);
  return id;
}

const bookmarkPayload = (text: string) =>
  sealed({
    version: 1,
    text,
    anchor: { start: 0, end: text.length },
    created_at: new Date().toISOString(),
  });

test.describe('bookmarks API', () => {
  test('owner can create/list/delete; another user cannot see or touch it', async () => {
    const owner = await provisionApiUser();
    const other = await provisionApiUser();
    try {
      const conversationID = await createConversation(owner);
      const messageID = randomBytes(8).toString('hex');
      const data = bookmarkPayload('highlighted span v1');

      const createRes = await owner.api.post('/api/v1/bookmarks', {
        data: { conversation: conversationID, message: messageID, data },
      });
      expect(
        createRes.ok(),
        `create: ${createRes.status()} ${await createRes.text()}`,
      ).toBe(true);
      const created = (await createRes.json()) as BookmarkRecord;
      expect(created.id).toBeTruthy();
      expect(created.data).toBe(data);
      expect(created.conversation).toBe(conversationID);
      expect(created.message).toBe(messageID);

      // Owner sees it; the other user's list is scoped to themselves.
      const ownerList = (await (
        await owner.api.get('/api/v1/bookmarks')
      ).json()) as BookmarkList;
      expect(ownerList.items.map((i) => i.id)).toContain(created.id);

      // The ?conversation filter returns the row for that conversation.
      const filtered = (await (
        await owner.api.get(`/api/v1/bookmarks?conversation=${conversationID}`)
      ).json()) as BookmarkList;
      expect(filtered.items.map((i) => i.id)).toContain(created.id);

      const otherList = (await (
        await other.api.get('/api/v1/bookmarks')
      ).json()) as BookmarkList;
      expect(otherList.items.map((i) => i.id)).not.toContain(created.id);

      // The other user cannot delete it (neutral 404, never a leak).
      expect((await other.api.delete(`/api/v1/bookmarks/${created.id}`)).status()).toBe(
        404,
      );

      // Owner deletes it.
      expect((await owner.api.delete(`/api/v1/bookmarks/${created.id}`)).status()).toBe(
        204,
      );
      const after = (await (
        await owner.api.get('/api/v1/bookmarks')
      ).json()) as BookmarkList;
      expect(after.items.map((i) => i.id)).not.toContain(created.id);
    } finally {
      await owner.api.dispose();
      await other.api.dispose();
    }
  });

  test('creating a bookmark on an inaccessible conversation is a 404', async () => {
    const owner = await provisionApiUser();
    const outsider = await provisionApiUser();
    try {
      const conversationID = await createConversation(owner);
      const res = await outsider.api.post('/api/v1/bookmarks', {
        data: {
          conversation: conversationID,
          message: randomBytes(8).toString('hex'),
          data: bookmarkPayload('sneak'),
        },
      });
      expect(res.status()).toBe(404);
    } finally {
      await owner.api.dispose();
      await outsider.api.dispose();
    }
  });

  test('unauthenticated callers are rejected', async () => {
    const api = await newAnonymousApi();
    try {
      expect((await api.get('/api/v1/bookmarks')).status()).toBe(401);
    } finally {
      await api.dispose();
    }
  });
});
