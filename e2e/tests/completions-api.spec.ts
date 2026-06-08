import { expect, test } from '@playwright/test';
import { randomBytes } from 'node:crypto';

import { newAnonymousApi, provisionApiUser } from './api-helpers';

interface ConversationResponse {
  id: string;
  key_version: number;
}

interface CompleteResponseUsage {
  input_tokens: number;
  output_tokens: number;
  total_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  cost_usd?: number;
  cost_chf?: number;
  cost_rappen?: number;
  used_provider_cost?: boolean;
}

interface CompleteResponse {
  request_id?: string;
  user_message_id?: string;
  assistant_message: {
    id?: string;
    parent_message_id?: string;
    content: string;
    agent_id?: string;
    model_id?: string;
    created_at: string;
  };
  expires_at?: string;
  usage: CompleteResponseUsage;
}

const APPROVED_MODEL_ID = 'llama-3-3-infomaniak';
const DEFAULT_AGENT_ID = 'cognos:simple-assistant';

const CONVERSATION_DATA = Buffer.from(
  JSON.stringify({ title: 'completion contract' }),
).toString('base64');

async function createConversation(
  user: Awaited<ReturnType<typeof provisionApiUser>>,
): Promise<string> {
  const res = await user.api.post('/api/v1/conversations', {
    data: { data: CONVERSATION_DATA, expiry_duration: '' },
  });
  expect(res.ok(), `conv: ${res.status()} ${await res.text()}`).toBe(true);
  const body = (await res.json()) as ConversationResponse;
  return body.id;
}

/**
 * Persisted completion needs a `conversation_public_keys` row so the
 * backend can encrypt the assistant reply. The handler doesn't validate
 * the key bytes (decryption is client-side), so we drop a 32-byte random
 * placeholder in via the first-party endpoint. Mirrors what the frontend
 * does during its full unlock flow.
 */
async function createConversationWithKey(
  user: Awaited<ReturnType<typeof provisionApiUser>>,
): Promise<string> {
  const conversationID = await createConversation(user);

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

test.describe('non-persisted /completions API', () => {
  test('unauthenticated callers are rejected', async () => {
    const api = await newAnonymousApi();
    try {
      const res = await api.post('/api/v1/completions', {
        data: {
          model_id: APPROVED_MODEL_ID,
          agent_id: DEFAULT_AGENT_ID,
          messages: [{ role: 'user', content: 'hello' }],
        },
      });
      expect(res.status()).toBe(401);
    } finally {
      await api.dispose();
    }
  });

  test('returns a usage block + assistant message for a valid request', async () => {
    // Drives the mock AI provider Playwright already starts. The response
    // contract here is what the frontend MessageService depends on:
    // assistant_message.content plus a usage block carrying input/output
    // token counts and CHF costing.
    const user = await provisionApiUser();
    try {
      const res = await user.api.post('/api/v1/completions', {
        data: {
          model_id: APPROVED_MODEL_ID,
          agent_id: DEFAULT_AGENT_ID,
          messages: [{ role: 'user', content: 'hello there' }],
        },
      });
      expect(res.ok(), `complete: ${res.status()} ${await res.text()}`).toBe(true);
      const body = (await res.json()) as CompleteResponse;

      expect(body.assistant_message.content).toBeTruthy();
      expect(body.usage).toBeTruthy();
      expect(typeof body.usage.input_tokens).toBe('number');
      expect(typeof body.usage.output_tokens).toBe('number');
    } finally {
      await user.api.dispose();
    }
  });

  test('rejects requests missing model_id with a focused 400', async () => {
    const user = await provisionApiUser();
    try {
      const res = await user.api.post('/api/v1/completions', {
        data: {
          agent_id: DEFAULT_AGENT_ID,
          messages: [{ role: 'user', content: 'hi' }],
        },
      });
      expect(res.status()).toBe(400);
      const body = (await res.json()) as { message?: string };
      expect(body.message ?? '').toMatch(/model id/i);
    } finally {
      await user.api.dispose();
    }
  });

  test('rejects requests with no messages array', async () => {
    const user = await provisionApiUser();
    try {
      const res = await user.api.post('/api/v1/completions', {
        data: {
          model_id: APPROVED_MODEL_ID,
          agent_id: DEFAULT_AGENT_ID,
          messages: [],
        },
      });
      expect(res.status()).toBe(400);
    } finally {
      await user.api.dispose();
    }
  });

  test('rejects requests whose trailing message is not from the user', async () => {
    // The completion contract requires the last message to be role=user
    // so the gateway sees a real prompt at the end. An assistant tail
    // would be a malformed conversation and must 400.
    const user = await provisionApiUser();
    try {
      const res = await user.api.post('/api/v1/completions', {
        data: {
          model_id: APPROVED_MODEL_ID,
          agent_id: DEFAULT_AGENT_ID,
          messages: [
            { role: 'user', content: 'hi' },
            { role: 'assistant', content: 'hello' },
          ],
        },
      });
      expect(res.status()).toBe(400);
    } finally {
      await user.api.dispose();
    }
  });

  test('rejects unknown model_id', async () => {
    const user = await provisionApiUser();
    try {
      const res = await user.api.post('/api/v1/completions', {
        data: {
          model_id: 'definitely-not-a-real-model',
          agent_id: DEFAULT_AGENT_ID,
          messages: [{ role: 'user', content: 'hi' }],
        },
      });
      expect(res.status()).toBe(400);
      const body = (await res.json()) as { message?: string };
      expect(body.message ?? '').toMatch(/model id/i);
    } finally {
      await user.api.dispose();
    }
  });

  test('rejects unknown agent_id', async () => {
    const user = await provisionApiUser();
    try {
      const res = await user.api.post('/api/v1/completions', {
        data: {
          model_id: APPROVED_MODEL_ID,
          agent_id: 'cognos:definitely-not-an-agent',
          messages: [{ role: 'user', content: 'hi' }],
        },
      });
      expect(res.status()).toBe(400);
    } finally {
      await user.api.dispose();
    }
  });
});

test.describe('persisted /conversations/{id}/complete API', () => {
  test('unauthenticated callers are rejected', async () => {
    const api = await newAnonymousApi();
    try {
      const res = await api.post('/api/v1/conversations/anyconv00000001/complete', {
        data: {
          model_id: APPROVED_MODEL_ID,
          agent_id: DEFAULT_AGENT_ID,
          messages: [{ role: 'user', content: 'hi' }],
        },
      });
      expect(res.status()).toBe(401);
    } finally {
      await api.dispose();
    }
  });

  test('participant can complete inside their own conversation', async () => {
    const user = await provisionApiUser();
    try {
      const conversationID = await createConversationWithKey(user);

      const res = await user.api.post(
        `/api/v1/conversations/${conversationID}/complete`,
        {
          data: {
            model_id: APPROVED_MODEL_ID,
            agent_id: DEFAULT_AGENT_ID,
            request_id: 'e2e-req-1',
            messages: [{ role: 'user', content: 'hello from the e2e suite' }],
          },
        },
      );
      expect(res.ok(), `complete: ${res.status()} ${await res.text()}`).toBe(true);

      const body = (await res.json()) as CompleteResponse;
      expect(body.request_id).toBe('e2e-req-1');
      expect(body.user_message_id).toBeTruthy();
      expect(body.assistant_message.id).toBeTruthy();
      expect(body.assistant_message.content).toBeTruthy();

      // After a successful persisted completion the conversation's
      // messages list must reflect both the user message and the
      // assistant reply.
      const listRes = await user.api.get(
        `/api/v1/conversations/${conversationID}/messages`,
      );
      expect(listRes.ok()).toBe(true);
      const list = (await listRes.json()) as { totalItems: number };
      expect(list.totalItems).toBeGreaterThanOrEqual(2);
    } finally {
      await user.api.dispose();
    }
  });

  test('non-participant cannot complete and the conversation stays empty', async () => {
    // Same gate as the participants spec but layered against the
    // completion path specifically: a non-participant must not be able
    // to attach messages to someone else's conversation.
    const owner = await provisionApiUser();
    const outsider = await provisionApiUser();
    try {
      const conversationID = await createConversation(owner);

      const res = await outsider.api.post(
        `/api/v1/conversations/${conversationID}/complete`,
        {
          data: {
            model_id: APPROVED_MODEL_ID,
            agent_id: DEFAULT_AGENT_ID,
            messages: [{ role: 'user', content: 'sneaky message' }],
          },
        },
      );
      expect(res.status()).toBe(404);

      const list = await owner.api.get(
        `/api/v1/conversations/${conversationID}/messages`,
      );
      const body = (await list.json()) as { totalItems: number };
      expect(body.totalItems).toBe(0);
    } finally {
      await owner.api.dispose();
      await outsider.api.dispose();
    }
  });
});
