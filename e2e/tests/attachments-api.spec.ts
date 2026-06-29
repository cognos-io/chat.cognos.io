import { expect, test } from '@playwright/test';
import type { APIResponse } from '@playwright/test';
import { randomBytes } from 'node:crypto';

import { newAnonymousApi, provisionApiUser } from './api-helpers';

const APPROVED_MODEL_ID = 'llama-3-3-infomaniak';
const DEFAULT_PERSONA_ID = 'cognos:simple-assistant';
const DEFAULT_SYSTEM_PROMPT = 'You are a helpful test persona.';

const CONVERSATION_DATA = Buffer.from(
  JSON.stringify({ title: 'attachments contract' }),
).toString('base64');

interface AttachmentResponse {
  id: string;
  size_bytes: number;
  files: string[];
  data: string;
}

interface AttachmentUsageResponse {
  conversation: string;
  message: string;
}

interface MessageListResponse {
  totalItems: number;
  items: { id: string; data: string }[];
}

async function createConversationWithKey(
  user: Awaited<ReturnType<typeof provisionApiUser>>,
): Promise<string> {
  const res = await user.api.post('/api/v1/conversations', {
    data: { data: CONVERSATION_DATA, expiry_duration: '' },
  });
  expect(res.ok(), `conv: ${res.status()} ${await res.text()}`).toBe(true);
  const conversationID = ((await res.json()) as { id: string }).id;

  const keyRes = await user.api.post(
    `/api/v1/conversations/${conversationID}/public-key`,
    {
      data: {
        public_key: randomBytes(32).toString('base64'),
        public_key_signature: randomBytes(32).toString('base64'),
      },
    },
  );
  expect(keyRes.ok(), `public-key: ${keyRes.status()} ${await keyRes.text()}`).toBe(
    true,
  );
  return conversationID;
}

async function uploadAttachment(
  user: Awaited<ReturnType<typeof provisionApiUser>>,
  ciphertext: Buffer,
  manifestB64: string,
): Promise<AttachmentResponse> {
  const res = await user.api.post('/api/v1/attachments', {
    multipart: {
      data: manifestB64,
      files: {
        name: 'art-0.enc',
        mimeType: 'application/octet-stream',
        buffer: ciphertext,
      },
    },
  });
  expect(res.ok(), `upload: ${res.status()} ${await res.text()}`).toBe(true);
  return (await res.json()) as AttachmentResponse;
}

async function readStreamText(res: APIResponse): Promise<string> {
  const text = await res.text();
  let content = '';
  for (const block of text.split('\n\n')) {
    const line = block.split('\n').find((l) => l.startsWith('data:'));
    if (!line) continue;
    const payload = line.slice('data:'.length).trim();
    if (!payload) continue;
    const event = JSON.parse(payload) as {
      type: string;
      response?: { assistant_message: { content: string } };
    };
    if (event.type === 'complete' && event.response) {
      content = event.response.assistant_message.content;
    }
  }
  return content;
}

test.describe('attachment library API', () => {
  test('unauthenticated callers cannot create attachments', async () => {
    const api = await newAnonymousApi();
    try {
      const res = await api.post('/api/v1/attachments', {
        multipart: {
          data: 'AAAA',
          files: {
            name: 'a.enc',
            mimeType: 'application/octet-stream',
            buffer: Buffer.from('x'),
          },
        },
      });
      expect(res.status()).toBe(401);
    } finally {
      await api.dispose();
    }
  });

  test('participant uploads and downloads ciphertext, round-trip exact', async () => {
    const user = await provisionApiUser();
    try {
      const ciphertext = randomBytes(64);
      const manifest = randomBytes(48).toString('base64');

      const created = await uploadAttachment(user, ciphertext, manifest);
      expect(created.id).toBeTruthy();
      expect(created.size_bytes).toBe(ciphertext.length);
      expect(created.files).toHaveLength(1);
      expect(created.data).toBe(manifest);

      const dl = await user.api.get(
        `/api/v1/attachments/${created.id}/files/${created.files[0]}`,
      );
      expect(dl.ok(), `download: ${dl.status()}`).toBe(true);
      const body = await dl.body();
      expect(Buffer.compare(body, ciphertext)).toBe(0);
    } finally {
      await user.api.dispose();
    }
  });

  test('a non-participant cannot read another user’s attachment', async () => {
    const owner = await provisionApiUser();
    const stranger = await provisionApiUser();
    try {
      const created = await uploadAttachment(
        owner,
        randomBytes(32),
        randomBytes(16).toString('base64'),
      );

      const list = await stranger.api.get('/api/v1/attachments');
      expect(list.ok(), `list: ${list.status()} ${await list.text()}`).toBe(true);
      expect((await list.json()) as AttachmentResponse[]).toEqual([]);

      const dl = await stranger.api.get(
        `/api/v1/attachments/${created.id}/files/${created.files[0]}`,
      );
      expect(dl.status()).toBe(404);
    } finally {
      await owner.api.dispose();
      await stranger.api.dispose();
    }
  });

  test('a non-owner cannot read another user’s attachment usages', async () => {
    const owner = await provisionApiUser();
    const stranger = await provisionApiUser();
    try {
      const created = await uploadAttachment(
        owner,
        randomBytes(32),
        randomBytes(16).toString('base64'),
      );

      // The owner can read usages (none yet) — proves the endpoint works.
      const ownerRes = await owner.api.get(`/api/v1/attachments/${created.id}/usages`);
      expect(
        ownerRes.ok(),
        `owner usages: ${ownerRes.status()} ${await ownerRes.text()}`,
      ).toBe(true);
      expect((await ownerRes.json()) as AttachmentUsageResponse[]).toEqual([]);

      // A stranger gets the same not-found as a missing id — the id is never
      // confirmed to a non-owner.
      const strangerRes = await stranger.api.get(
        `/api/v1/attachments/${created.id}/usages`,
      );
      expect(strangerRes.status()).toBe(404);

      // And an unauthenticated caller is rejected outright.
      const anon = await newAnonymousApi();
      try {
        const res = await anon.get(`/api/v1/attachments/${created.id}/usages`);
        expect(res.status()).toBe(401);
      } finally {
        await anon.dispose();
      }
    } finally {
      await owner.api.dispose();
      await stranger.api.dispose();
    }
  });

  test('completion wraps attachment context as untrusted and links the attachment', async () => {
    const user = await provisionApiUser();
    try {
      const conversationID = await createConversationWithKey(user);
      const created = await uploadAttachment(
        user,
        randomBytes(32),
        randomBytes(16).toString('base64'),
      );

      const docBody = 'ATTACHMENT_DOC_BODY_12345';
      const res = await user.api.post(
        `/api/v1/conversations/${conversationID}/complete`,
        {
          data: {
            model_id: APPROVED_MODEL_ID,
            persona_id: DEFAULT_PERSONA_ID,
            system_prompt: DEFAULT_SYSTEM_PROMPT,
            // [echo] makes the mock reply with the (server-assembled) user turn,
            // so we can assert the wrapper + doc body actually reached the model.
            messages: [{ role: 'user', content: '[echo]summarise the attachment' }],
            attachment_ids: [created.id],
            attachment_contexts: [
              {
                attachment_id: created.id,
                display_name: 'notes.txt',
                detected_mime_type: 'text/plain',
                processor_id: 'text',
                text_context: docBody,
              },
            ],
          },
        },
      );
      expect(res.ok(), `complete: ${res.status()} ${await res.text()}`).toBe(true);

      const content = await readStreamText(res);
      expect(content).toContain('untrusted user-provided data');
      expect(content).toContain(docBody);

      // The library attachment is now linked to a message usage.
      const usagesRes = await user.api.get(`/api/v1/attachments/${created.id}/usages`);
      expect(
        usagesRes.ok(),
        `usages: ${usagesRes.status()} ${await usagesRes.text()}`,
      ).toBe(true);
      const usages = (await usagesRes.json()) as AttachmentUsageResponse[];
      expect(usages).toHaveLength(1);
      expect(usages[0].conversation).toBe(conversationID);
      expect(usages[0].message).not.toBe('');

      // No persisted message ciphertext may contain the plaintext context.
      const msgRes = await user.api.get(
        `/api/v1/conversations/${conversationID}/messages?page=1&page_size=50`,
      );
      const messages = (await msgRes.json()) as MessageListResponse;
      for (const message of messages.items) {
        expect(message.data).not.toContain(docBody);
      }
    } finally {
      await user.api.dispose();
    }
  });

  test('completion rejects an attachment id owned by another user', async () => {
    const owner = await provisionApiUser();
    const stranger = await provisionApiUser();
    try {
      const conversationID = await createConversationWithKey(stranger);
      const foreign = await uploadAttachment(
        owner,
        randomBytes(16),
        randomBytes(16).toString('base64'),
      );

      const res = await stranger.api.post(
        `/api/v1/conversations/${conversationID}/complete`,
        {
          data: {
            model_id: APPROVED_MODEL_ID,
            persona_id: DEFAULT_PERSONA_ID,
            system_prompt: DEFAULT_SYSTEM_PROMPT,
            messages: [{ role: 'user', content: 'hi' }],
            attachment_ids: [foreign.id],
          },
        },
      );
      expect(res.status()).toBe(400);
      expect(await res.text()).toContain('Invalid attachment reference');
    } finally {
      await owner.api.dispose();
      await stranger.api.dispose();
    }
  });
});
