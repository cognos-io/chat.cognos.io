import { expect, test } from '@playwright/test';
import type { APIResponse } from '@playwright/test';
import { randomBytes } from 'node:crypto';

import { provisionApiUser, setModelFlag } from './api-helpers';
import { type KeyPairB64, generateKeyPair, openSealed } from './crypto-helpers';

// A Requesty (EU bedrock) model. Web search ships off in prod, so the suite
// flips supports_web_search on at runtime via the superuser (beforeAll). No
// other spec references this model, so the flag change is isolated.
const WEB_SEARCH_MODEL_ID = 'claude-sonnet-4-6';
// Infomaniak model: never web-search-capable, exercises the silent-drop gate.
const INFOMANIAK_MODEL_ID = 'llama-3-3-infomaniak';
const DEFAULT_PERSONA_ID = 'cognos:simple-assistant';
const DEFAULT_SYSTEM_PROMPT = 'You are a helpful test persona.';

// The mock provider's web-search fixtures (cmd/mock-ai-provider). When the
// web_search tool is on the wire the mock returns this accented reply and
// anchors a citation onto "légal", so byte offsets differ from code points.
const MOCK_WEB_SEARCH_REPLY = 'Le salaire minimum légal est fixé par le canton.';
const MOCK_WEB_SEARCH_ANCHOR = 'légal';
const MOCK_CITATION_URL = 'https://example.com/geneva-minimum-wage';
const MOCK_CITATION_TITLE = 'example.com';
const MOCK_SOURCE_PROXY_URL =
  'https://vertexaisearch.cloud.google.com/grounding-api-redirect/MOCKPROXY';
const MOCK_DEFAULT_REPLY = 'Mocked assistant reply';

interface SseCitation {
  url: string;
  title?: string;
  snippet?: string;
}
interface SseCitationAnchor {
  citation: number;
  start: number;
  end: number;
}

interface WebSearchStream {
  deltaText: string;
  citations: SseCitation[];
  anchors: SseCitationAnchor[];
  activities: string[];
  assistantId?: string;
}

// readWebSearchStream parses the SSE stream, accumulating the incremental
// `web_search` events exactly as the frontend must: citations are newly-seen
// only, anchors carry stable citation indices, and search_activity reports the
// lifecycle. The terminal `complete` event supplies the assistant message id.
async function readWebSearchStream(res: APIResponse): Promise<WebSearchStream> {
  const text = await res.text();
  const out: WebSearchStream = {
    deltaText: '',
    citations: [],
    anchors: [],
    activities: [],
  };
  for (const block of text.split('\n\n')) {
    const line = block.split('\n').find((l) => l.startsWith('data:'));
    if (!line) continue;
    const payload = line.slice('data:'.length).trim();
    if (!payload || payload === '[DONE]') continue;
    const event = JSON.parse(payload) as {
      type: string;
      delta?: string;
      message?: string;
      citations?: SseCitation[];
      citation_anchors?: SseCitationAnchor[];
      search_activity?: string;
      response?: { assistant_message?: { id?: string } };
    };
    if (event.type === 'error') {
      throw new Error(`completion stream error: ${event.message ?? 'unknown'}`);
    }
    if (event.type === 'delta') out.deltaText += event.delta ?? '';
    if (event.type === 'web_search') {
      if (event.citations) out.citations.push(...event.citations);
      if (event.citation_anchors) out.anchors.push(...event.citation_anchors);
      if (event.search_activity) out.activities.push(event.search_activity);
    }
    if (event.type === 'complete' && event.response) {
      out.assistantId = event.response.assistant_message?.id;
    }
  }
  return out;
}

async function createConversationWithRealKey(
  user: Awaited<ReturnType<typeof provisionApiUser>>,
): Promise<{ conversationID: string; keyPair: KeyPairB64 }> {
  const convData = Buffer.from(JSON.stringify({ title: 'web search' })).toString(
    'base64',
  );
  const conv = await user.api.post('/api/v1/conversations', {
    data: { data: convData, expiry_duration: '' },
  });
  expect(conv.ok(), `conv: ${conv.status()} ${await conv.text()}`).toBe(true);
  const conversationID = ((await conv.json()) as { id: string }).id;

  // Register a real keypair's public half so the backend seals the assistant
  // message to it and the test can decrypt what was persisted.
  const keyPair = generateKeyPair();
  const keyRes = await user.api.post(
    `/api/v1/conversations/${conversationID}/public-key`,
    {
      data: {
        public_key: keyPair.publicKey,
        public_key_signature: randomBytes(32).toString('base64'),
      },
    },
  );
  expect(keyRes.ok(), `public-key: ${keyRes.status()} ${await keyRes.text()}`).toBe(
    true,
  );
  return { conversationID, keyPair };
}

interface PersistedMessage {
  citations?: SseCitation[];
  citation_anchors?: SseCitationAnchor[];
  content?: string;
}

// decryptMessages fetches every stored message and opens the sealed box with
// the conversation keypair, so the test can assert what is actually persisted.
async function decryptMessages(
  user: Awaited<ReturnType<typeof provisionApiUser>>,
  conversationID: string,
  keyPair: KeyPairB64,
): Promise<{ decoded: PersistedMessage; raw: string }[]> {
  const listRes = await user.api.get(
    `/api/v1/conversations/${conversationID}/messages?page=1&page_size=50`,
  );
  expect(listRes.ok()).toBe(true);
  const list = (await listRes.json()) as { items: { data: string }[] };
  return list.items.map((item) => ({
    raw: item.data,
    decoded: JSON.parse(
      new TextDecoder().decode(openSealed(keyPair, item.data)),
    ) as PersistedMessage,
  }));
}

test.beforeAll(async () => {
  await setModelFlag(WEB_SEARCH_MODEL_ID, 'supports_web_search', true);
});

test.describe('web search /conversations/{id}/complete API', () => {
  test('capable model + default on: citations + anchors stream and persist encrypted', async () => {
    const user = await provisionApiUser();
    try {
      const { conversationID, keyPair } = await createConversationWithRealKey(user);

      // No web_search field → defaults on. A capable Requesty model → the tool
      // goes on the wire, which the mock reflects with web-search events.
      const res = await user.api.post(
        `/api/v1/conversations/${conversationID}/complete`,
        {
          data: {
            model_id: WEB_SEARCH_MODEL_ID,
            persona_id: DEFAULT_PERSONA_ID,
            system_prompt: DEFAULT_SYSTEM_PROMPT,
            messages: [{ role: 'user', content: 'what is the minimum wage' }],
          },
        },
      );
      expect(res.ok(), `complete: ${res.status()} ${await res.text()}`).toBe(true);

      const stream = await readWebSearchStream(res);

      // Tool was on the wire (mock only emits web-search shape when it is).
      expect(stream.deltaText).toBe(MOCK_WEB_SEARCH_REPLY);
      expect(stream.activities).toContain('completed');

      // Two citations: the annotation source (with title) + the title-less proxy
      // action source, de-duplicated by URL.
      expect(stream.citations).toHaveLength(2);
      expect(stream.citations[0]).toMatchObject({
        url: MOCK_CITATION_URL,
        title: MOCK_CITATION_TITLE,
      });
      expect(stream.citations[1].url).toBe(MOCK_SOURCE_PROXY_URL);
      expect(stream.citations[1].title ?? '').toBe('');

      // One anchor at code-point offsets (byte offsets converted).
      const before = MOCK_WEB_SEARCH_REPLY.slice(
        0,
        MOCK_WEB_SEARCH_REPLY.indexOf(MOCK_WEB_SEARCH_ANCHOR),
      );
      const wantStart = [...before].length;
      const wantEnd = wantStart + [...MOCK_WEB_SEARCH_ANCHOR].length;
      expect(stream.anchors).toHaveLength(1);
      expect(stream.anchors[0]).toEqual({
        citation: 0,
        start: wantStart,
        end: wantEnd,
      });

      // Persistence: the assistant message carries citations + anchors, encrypted
      // at rest (the citation URL must not appear in the stored ciphertext).
      const messages = await decryptMessages(user, conversationID, keyPair);
      const assistant = messages.find((m) => m.decoded.citations !== undefined);
      expect(assistant, 'assistant message with citations not persisted').toBeTruthy();
      expect(assistant!.decoded.citations).toHaveLength(2);
      expect(assistant!.decoded.citations![0].url).toBe(MOCK_CITATION_URL);
      expect(assistant!.decoded.citation_anchors).toEqual([
        { citation: 0, start: wantStart, end: wantEnd },
      ]);
      for (const m of messages) {
        expect(m.raw).not.toContain(MOCK_CITATION_URL);
        expect(Buffer.from(m.raw, 'base64').toString('utf8')).not.toContain(
          MOCK_CITATION_URL,
        );
      }
    } finally {
      await user.api.dispose();
    }
  });

  test('web_search:false sends no tool — no citations, plain reply', async () => {
    const user = await provisionApiUser();
    try {
      const { conversationID } = await createConversationWithRealKey(user);
      const res = await user.api.post(
        `/api/v1/conversations/${conversationID}/complete`,
        {
          data: {
            model_id: WEB_SEARCH_MODEL_ID,
            persona_id: DEFAULT_PERSONA_ID,
            system_prompt: DEFAULT_SYSTEM_PROMPT,
            web_search: false,
            messages: [{ role: 'user', content: 'what is the minimum wage' }],
          },
        },
      );
      expect(res.ok(), `complete: ${res.status()} ${await res.text()}`).toBe(true);

      const stream = await readWebSearchStream(res);
      expect(stream.deltaText).toBe(MOCK_DEFAULT_REPLY);
      expect(stream.citations).toHaveLength(0);
      expect(stream.anchors).toHaveLength(0);
      expect(stream.activities).toHaveLength(0);
    } finally {
      await user.api.dispose();
    }
  });

  test('non-capable Infomaniak model + web_search:true: tool dropped, completion succeeds', async () => {
    const user = await provisionApiUser();
    try {
      const { conversationID } = await createConversationWithRealKey(user);
      const res = await user.api.post(
        `/api/v1/conversations/${conversationID}/complete`,
        {
          data: {
            model_id: INFOMANIAK_MODEL_ID,
            persona_id: DEFAULT_PERSONA_ID,
            system_prompt: DEFAULT_SYSTEM_PROMPT,
            web_search: true,
            messages: [{ role: 'user', content: 'what is the minimum wage' }],
          },
        },
      );
      // No 400 — the tool is silently dropped for a non-capable provider.
      expect(res.ok(), `complete: ${res.status()} ${await res.text()}`).toBe(true);

      const stream = await readWebSearchStream(res);
      expect(stream.deltaText).toBeTruthy();
      expect(stream.deltaText).not.toBe(MOCK_WEB_SEARCH_REPLY);
      expect(stream.citations).toHaveLength(0);
      expect(stream.activities).toHaveLength(0);
    } finally {
      await user.api.dispose();
    }
  });
});
