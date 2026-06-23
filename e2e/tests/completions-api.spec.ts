import { expect, test } from '@playwright/test';
import type { APIResponse } from '@playwright/test';
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
  reasoning_tokens?: number;
}

interface CompleteResponse {
  request_id?: string;
  user_message_id?: string;
  assistant_message: {
    id?: string;
    parent_message_id?: string;
    content: string;
    reasoning?: string;
    persona_id?: string;
    model_id?: string;
    created_at: string;
  };
  expires_at?: string;
  usage: CompleteResponseUsage;
}

interface MessageListResponse {
  totalItems: number;
  items: { id: string; data: string }[];
}

const APPROVED_MODEL_ID = 'llama-3-3-infomaniak';
const DEFAULT_PERSONA_ID = 'cognos:simple-assistant';
const DEFAULT_SYSTEM_PROMPT = 'You are a helpful test persona.';

// The completion endpoints stream Server-Sent Events: `data: {json}\n\n` per
// event, with `type: 'delta'` carrying incremental text and a terminal
// `type: 'complete'` carrying the full response. Parse the stream and return
// that final response (the contract the frontend MessageService consumes).
async function readCompleteStream(res: APIResponse): Promise<CompleteResponse> {
  const text = await res.text();
  let final: CompleteResponse | undefined;
  let deltaText = '';
  let reasoningText = '';
  for (const block of text.split('\n\n')) {
    const line = block.split('\n').find((l) => l.startsWith('data:'));
    if (!line) continue;
    const payload = line.slice('data:'.length).trim();
    if (!payload || payload === '[DONE]') continue;
    const event = JSON.parse(payload) as {
      type: string;
      delta?: string;
      message?: string;
      response?: CompleteResponse;
    };
    if (event.type === 'error') {
      throw new Error(`completion stream error: ${event.message ?? 'unknown'}`);
    }
    if (event.type === 'delta') deltaText += event.delta ?? '';
    if (event.type === 'reasoning_delta') reasoningText += event.delta ?? '';
    if (event.type === 'complete' && event.response) final = event.response;
  }
  if (!final) {
    throw new Error(`no 'complete' event in stream: ${text.slice(0, 200)}`);
  }
  // The streamed deltas must reconstruct the assistant content.
  if (deltaText) expect(final.assistant_message.content).toBe(deltaText);
  // Reasoning deltas stream on their own channel and reconstruct the final
  // reasoning — never mixing into the answer content.
  if (reasoningText) {
    expect(final.assistant_message.reasoning).toBe(reasoningText);
    expect(deltaText).not.toContain(reasoningText);
  }
  return final;
}

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
          persona_id: DEFAULT_PERSONA_ID,
          system_prompt: DEFAULT_SYSTEM_PROMPT,
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
          persona_id: DEFAULT_PERSONA_ID,
          system_prompt: DEFAULT_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: 'hello there' }],
        },
      });
      expect(res.ok(), `complete: ${res.status()} ${await res.text()}`).toBe(true);
      const body = await readCompleteStream(res);

      expect(body.assistant_message.content).toBeTruthy();
      expect(body.assistant_message.persona_id).toBe(DEFAULT_PERSONA_ID);
      // created_at must be RFC 3339 (ISO-8601 with a "T") so the frontend can
      // parse it in any browser. The persisted copy is encrypted inside the
      // message blob; this is the value the UI renders optimistically.
      expect(body.assistant_message.created_at).toMatch(
        /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/,
      );
      expect(Number.isNaN(Date.parse(body.assistant_message.created_at))).toBe(false);
      expect(body.usage).toBeTruthy();
      expect(typeof body.usage.input_tokens).toBe('number');
      expect(typeof body.usage.output_tokens).toBe('number');
    } finally {
      await user.api.dispose();
    }
  });

  test('streams reasoning separately and reports reasoning_tokens for a reasoning model', async () => {
    // The mock provider's [reason] sentinel makes it return a reasoning trace
    // plus reasoning_tokens, exercising the full gateway → handler reasoning
    // path. readCompleteStream asserts the reasoning_delta events reconstruct
    // the final reasoning and never bleed into the answer content.
    const user = await provisionApiUser();
    try {
      const res = await user.api.post('/api/v1/completions', {
        data: {
          model_id: APPROVED_MODEL_ID,
          persona_id: DEFAULT_PERSONA_ID,
          system_prompt: DEFAULT_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: '[reason]why is the sky blue?' }],
        },
      });
      expect(res.ok(), `complete: ${res.status()} ${await res.text()}`).toBe(true);
      const body = await readCompleteStream(res);

      expect(body.assistant_message.reasoning).toBe('Mock reasoning trace');
      expect(body.assistant_message.content).toBeTruthy();
      expect(body.assistant_message.content).not.toContain('Mock reasoning trace');
      expect(body.usage.reasoning_tokens).toBe(7);
    } finally {
      await user.api.dispose();
    }
  });

  test('a model without reasoning returns reasoning_tokens: 0 and no reasoning text', async () => {
    const user = await provisionApiUser();
    try {
      const res = await user.api.post('/api/v1/completions', {
        data: {
          model_id: APPROVED_MODEL_ID,
          persona_id: DEFAULT_PERSONA_ID,
          system_prompt: DEFAULT_SYSTEM_PROMPT,
          messages: [{ role: 'user', content: 'plain question' }],
        },
      });
      expect(res.ok(), `complete: ${res.status()} ${await res.text()}`).toBe(true);
      const body = await readCompleteStream(res);

      // omitempty drops the field entirely when there's no reasoning.
      expect(body.assistant_message.reasoning ?? '').toBe('');
      expect(body.usage.reasoning_tokens ?? 0).toBe(0);
    } finally {
      await user.api.dispose();
    }
  });

  test('rejects requests missing model_id with a focused 400', async () => {
    const user = await provisionApiUser();
    try {
      const res = await user.api.post('/api/v1/completions', {
        data: {
          persona_id: DEFAULT_PERSONA_ID,
          system_prompt: DEFAULT_SYSTEM_PROMPT,
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
          persona_id: DEFAULT_PERSONA_ID,
          system_prompt: DEFAULT_SYSTEM_PROMPT,
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
          persona_id: DEFAULT_PERSONA_ID,
          system_prompt: DEFAULT_SYSTEM_PROMPT,
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
          persona_id: DEFAULT_PERSONA_ID,
          system_prompt: DEFAULT_SYSTEM_PROMPT,
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

  test('rejects missing system_prompt', async () => {
    const user = await provisionApiUser();
    try {
      const res = await user.api.post('/api/v1/completions', {
        data: {
          model_id: APPROVED_MODEL_ID,
          persona_id: DEFAULT_PERSONA_ID,
          messages: [{ role: 'user', content: 'hi' }],
        },
      });
      expect(res.status()).toBe(400);
      const body = (await res.json()) as { message?: string };
      expect(body.message ?? '').toMatch(/system prompt/i);
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
          persona_id: DEFAULT_PERSONA_ID,
          system_prompt: DEFAULT_SYSTEM_PROMPT,
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
            persona_id: DEFAULT_PERSONA_ID,
            system_prompt: DEFAULT_SYSTEM_PROMPT,
            request_id: 'e2e-req-1',
            messages: [{ role: 'user', content: 'hello from the e2e suite' }],
          },
        },
      );
      expect(res.ok(), `complete: ${res.status()} ${await res.text()}`).toBe(true);

      const body = await readCompleteStream(res);
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

  test('persisted reasoning is encrypted at rest — never stored as plaintext', async () => {
    // The headline privacy guarantee: even though reasoning is returned to the
    // client, it must only live inside the encrypted message blob. Drive a
    // [reason] completion, then read the raw stored ciphertext back and assert
    // the known reasoning plaintext appears nowhere in it.
    const user = await provisionApiUser();
    try {
      const conversationID = await createConversationWithKey(user);

      const res = await user.api.post(
        `/api/v1/conversations/${conversationID}/complete`,
        {
          data: {
            model_id: APPROVED_MODEL_ID,
            persona_id: DEFAULT_PERSONA_ID,
            system_prompt: DEFAULT_SYSTEM_PROMPT,
            request_id: 'e2e-reason-1',
            messages: [{ role: 'user', content: '[reason]explain yourself' }],
          },
        },
      );
      expect(res.ok(), `complete: ${res.status()} ${await res.text()}`).toBe(true);

      const body = await readCompleteStream(res);
      expect(body.assistant_message.reasoning).toBe('Mock reasoning trace');

      const listRes = await user.api.get(
        `/api/v1/conversations/${conversationID}/messages?page=1&page_size=50`,
      );
      expect(listRes.ok()).toBe(true);
      const list = (await listRes.json()) as MessageListResponse;

      // No stored ciphertext may contain the reasoning plaintext, whether read
      // as the raw base64 column or decoded to bytes.
      for (const item of list.items) {
        expect(item.data).not.toContain('Mock reasoning trace');
        const decoded = Buffer.from(item.data, 'base64').toString('utf8');
        expect(decoded).not.toContain('Mock reasoning trace');
      }
    } finally {
      await user.api.dispose();
    }
  });

  test('persists an assistant reply longer than the 5000-char text default', async () => {
    // Regression for "Must be no more than 5000 character(s)." on
    // /complete. messages.data holds base64(ciphertext); a long assistant
    // reply pushes it past PocketBase's implicit 5000-char default for a text
    // field with no explicit max. Migration 1760000029 raised the cap to 1MB.
    // The mock provider's [echo] sentinel returns the user turn verbatim, so we
    // drive the reply size from here and exercise both the user-message and
    // assistant-message save paths in one request.
    const user = await provisionApiUser();
    try {
      const conversationID = await createConversationWithKey(user);

      // ~8k chars of plaintext: comfortably past 5000 once JSON-wrapped,
      // encrypted and base64-encoded, for both the prompt and the echoed reply.
      const largeBody = 'x'.repeat(8000);
      const prompt = `[echo]${largeBody}`;

      const res = await user.api.post(
        `/api/v1/conversations/${conversationID}/complete`,
        {
          data: {
            model_id: APPROVED_MODEL_ID,
            persona_id: DEFAULT_PERSONA_ID,
            system_prompt: DEFAULT_SYSTEM_PROMPT,
            request_id: 'e2e-large-1',
            messages: [{ role: 'user', content: prompt }],
          },
        },
      );
      expect(res.ok(), `complete: ${res.status()} ${await res.text()}`).toBe(true);

      const body = await readCompleteStream(res);
      // The reply echoed the prompt verbatim (sentinel stripped).
      expect(body.assistant_message.content).toBe(largeBody);

      // Both turns persisted, and at least one stored ciphertext exceeds the
      // old 5000-char cap — proving the field now accepts large messages.
      const listRes = await user.api.get(
        `/api/v1/conversations/${conversationID}/messages?page=1&page_size=50`,
      );
      expect(listRes.ok()).toBe(true);
      const list = (await listRes.json()) as MessageListResponse;
      expect(list.totalItems).toBeGreaterThanOrEqual(2);
      const longestCiphertext = Math.max(...list.items.map((m) => m.data.length));
      expect(longestCiphertext).toBeGreaterThan(5000);
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
            persona_id: DEFAULT_PERSONA_ID,
            system_prompt: DEFAULT_SYSTEM_PROMPT,
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
