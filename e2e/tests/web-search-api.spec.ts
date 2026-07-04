import { expect, test } from '@playwright/test';
import type { APIResponse } from '@playwright/test';
import { randomBytes } from 'node:crypto';

import { provisionApiUser, setModelFlag } from './api-helpers';
import { type KeyPairB64, generateKeyPair, openSealed } from './crypto-helpers';

// A Requesty (EU bedrock) model. Web search ships off in prod, so the suite
// flips supports_web_search on at runtime via the superuser (beforeAll). No
// other spec references this model, so the flag change is isolated.
const WEB_SEARCH_MODEL_ID = 'claude-sonnet-4-6';
// An Azure OpenAI (Responses) model — the mock returns the Azure-shaped stream
// for it (code-point offsets, real-URL sources, a phantom search).
const WEB_SEARCH_AZURE_MODEL_ID = 'responses-gpt-5-5';
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
// Azure-shaped fixture (cmd/mock-ai-provider): code-point offsets, the citation
// annotation on the same item as the text, three real-URL action sources (more
// than the single annotated URL), and a phantom empty search that must not add
// a citation.
const MOCK_AZURE_REPLY =
  'Le salaire minimum légal à Genève est de 24,59 CHF brut par heure.';
const MOCK_AZURE_ANCHOR = 'légal';
const MOCK_AZURE_CITATION_URL = 'https://www.ge.ch/actualite/salaire-minimum-2026';
const MOCK_AZURE_SOURCE_COUNT = 3;
// Appending this anywhere in the last user message opts the mock Responses
// handler into reporting a bare-float provider cost on the terminal usage
// event (cmd/mock-ai-provider: costSentinel / mockProviderCostUSD).
const MOCK_COST_SENTINEL = '[cost]';
const MOCK_PROVIDER_COST_USD = 0.0387346;

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

interface BillingTransaction {
  amount_chf: number;
  type: string;
  model_id?: string;
}

// newestUsageTransaction reads the caller's billing ledger and returns the
// most recent `usage` row — the one the just-completed request produced.
async function newestUsageTransaction(
  user: Awaited<ReturnType<typeof provisionApiUser>>,
): Promise<BillingTransaction> {
  const res = await user.api.get('/api/v1/billing/transactions');
  expect(res.ok(), `transactions: ${res.status()} ${await res.text()}`).toBe(true);
  const body = (await res.json()) as { transactions: BillingTransaction[] };
  const newest = body.transactions.find((t) => t.type === 'usage');
  expect(newest, 'no usage transaction recorded').toBeTruthy();
  return newest!;
}

// Fresh e2e users land on the trial plan (DefaultTrialStateSeed), where usage
// is metered as a real balance debit — the floor-fee assertions below only
// hold on a metered plan (trial/payg), never on unlimited.
async function isMeteredPlan(
  user: Awaited<ReturnType<typeof provisionApiUser>>,
): Promise<boolean> {
  const res = await user.api.get('/api/v1/billing');
  const body = (await res.json()) as { plan_type: string };
  return body.plan_type === 'trial' || body.plan_type === 'payg';
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
  // The Azure Responses model ships non-whitelisted; whitelist it (runtime only,
  // prod unaffected) so the completion path accepts it, and enable web search.
  await setModelFlag(WEB_SEARCH_AZURE_MODEL_ID, 'whitelisted', true);
  await setModelFlag(WEB_SEARCH_AZURE_MODEL_ID, 'supports_web_search', true);
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

  test('persist:false temporary turn: web_search streams but nothing is stored', async () => {
    const user = await provisionApiUser();
    try {
      const { conversationID, keyPair } = await createConversationWithRealKey(user);

      // A temporary (non-persisted) turn on a capable model: the tool still runs
      // and citations stream live, but neither the user turn nor the assistant
      // answer — and therefore no citations — is ever written to the store.
      const res = await user.api.post(
        `/api/v1/conversations/${conversationID}/complete`,
        {
          data: {
            model_id: WEB_SEARCH_MODEL_ID,
            persona_id: DEFAULT_PERSONA_ID,
            system_prompt: DEFAULT_SYSTEM_PROMPT,
            persist: false,
            messages: [{ role: 'user', content: 'what is the minimum wage' }],
          },
        },
      );
      expect(res.ok(), `complete: ${res.status()} ${await res.text()}`).toBe(true);

      const stream = await readWebSearchStream(res);
      expect(stream.deltaText).toBe(MOCK_WEB_SEARCH_REPLY);
      expect(stream.citations).toHaveLength(2);
      expect(stream.activities).toContain('completed');

      const messages = await decryptMessages(user, conversationID, keyPair);
      expect(messages, 'a persist:false turn must store no messages').toHaveLength(0);
    } finally {
      await user.api.dispose();
    }
  });

  test('web search + attachment context coexist: both apply, answer persists citations', async () => {
    const user = await provisionApiUser();
    try {
      const { conversationID, keyPair } = await createConversationWithRealKey(user);

      // Web search (default on) alongside a transient attachment context: the
      // tool still goes on the wire and citations come back, and the attachment
      // text is folded into the user turn — the two contexts do not clash.
      const res = await user.api.post(
        `/api/v1/conversations/${conversationID}/complete`,
        {
          data: {
            model_id: WEB_SEARCH_MODEL_ID,
            persona_id: DEFAULT_PERSONA_ID,
            system_prompt: DEFAULT_SYSTEM_PROMPT,
            messages: [
              { role: 'user', content: 'summarise the note and check the web' },
            ],
            attachment_contexts: [
              {
                attachment_id: 'att-e2e-websearch',
                display_name: 'note.txt',
                detected_mime_type: 'text/plain',
                processor_id: 'text',
                text_context: 'A short cantonal minimum-wage note.',
              },
            ],
          },
        },
      );
      expect(res.ok(), `complete: ${res.status()} ${await res.text()}`).toBe(true);

      const stream = await readWebSearchStream(res);
      expect(stream.deltaText).toBe(MOCK_WEB_SEARCH_REPLY);
      expect(stream.citations).toHaveLength(2);
      expect(stream.activities).toContain('completed');

      const messages = await decryptMessages(user, conversationID, keyPair);
      const assistant = messages.find((m) => m.decoded.citations !== undefined);
      expect(assistant, 'assistant answer with citations not persisted').toBeTruthy();
      expect(assistant!.decoded.citations).toHaveLength(2);
    } finally {
      await user.api.dispose();
    }
  });

  test('Azure family: action sources exceed annotations; phantom search adds no citation', async () => {
    const user = await provisionApiUser();
    try {
      const { conversationID, keyPair } = await createConversationWithRealKey(user);

      const res = await user.api.post(
        `/api/v1/conversations/${conversationID}/complete`,
        {
          data: {
            model_id: WEB_SEARCH_AZURE_MODEL_ID,
            persona_id: DEFAULT_PERSONA_ID,
            system_prompt: DEFAULT_SYSTEM_PROMPT,
            messages: [{ role: 'user', content: 'what is the minimum wage' }],
          },
        },
      );
      expect(res.ok(), `complete: ${res.status()} ${await res.text()}`).toBe(true);

      const stream = await readWebSearchStream(res);
      expect(stream.deltaText).toBe(MOCK_AZURE_REPLY);

      // The search returned three real-URL sources; only one URL is annotated,
      // and the phantom empty search contributes nothing → three citations.
      expect(stream.citations).toHaveLength(MOCK_AZURE_SOURCE_COUNT);
      expect(stream.citations.map((c) => c.url)).toContain(MOCK_AZURE_CITATION_URL);

      // A single anchor with CODE-POINT offsets (not byte offsets) referencing
      // the annotated citation.
      const before = MOCK_AZURE_REPLY.slice(
        0,
        MOCK_AZURE_REPLY.indexOf(MOCK_AZURE_ANCHOR),
      );
      const wantStart = [...before].length;
      const wantEnd = wantStart + [...MOCK_AZURE_ANCHOR].length;
      expect(stream.anchors).toHaveLength(1);
      const citedURL = stream.citations[stream.anchors[0].citation].url;
      expect(citedURL).toBe(MOCK_AZURE_CITATION_URL);
      expect(stream.anchors[0].start).toBe(wantStart);
      expect(stream.anchors[0].end).toBe(wantEnd);

      // Persisted encrypted message carries all sources + the anchor.
      const messages = await decryptMessages(user, conversationID, keyPair);
      const assistant = messages.find((m) => m.decoded.citations !== undefined);
      expect(assistant, 'assistant answer with citations not persisted').toBeTruthy();
      expect(assistant!.decoded.citations).toHaveLength(MOCK_AZURE_SOURCE_COUNT);
      expect(assistant!.decoded.citation_anchors).toHaveLength(1);
    } finally {
      await user.api.dispose();
    }
  });
});

test.describe('web search billing: per-search floor fee', () => {
  test('search with no provider-reported cost: floor fee alone is charged', async () => {
    const user = await provisionApiUser();
    try {
      const metered = await isMeteredPlan(user);
      const { conversationID } = await createConversationWithRealKey(user);

      // Default on, capable model, no [cost] sentinel: the mock reports zero
      // provider cost, so any charge at all can only come from the floor fee.
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
      expect(stream.deltaText).toBe(MOCK_WEB_SEARCH_REPLY);

      if (!metered) return; // unlimited plans record no per-turn deduction.

      const txn = await newestUsageTransaction(user);
      expect(txn.model_id).toBe(WEB_SEARCH_MODEL_ID);
      // Token cost on the mock's 1-input/1-output-token usage rounds to
      // nothing at whole-rappen granularity; the seeded floor fee
      // (CHF 0.009, config default) rounds up to CHF 0.01 on its own — so a
      // non-trivial charge here proves the floor applied.
      expect(Math.abs(txn.amount_chf)).toBeGreaterThanOrEqual(0.01);
    } finally {
      await user.api.dispose();
    }
  });

  test('search with a reported provider cost: floor fee is still added on top', async () => {
    const user = await provisionApiUser();
    try {
      const metered = await isMeteredPlan(user);
      const { conversationID } = await createConversationWithRealKey(user);

      const res = await user.api.post(
        `/api/v1/conversations/${conversationID}/complete`,
        {
          data: {
            model_id: WEB_SEARCH_MODEL_ID,
            persona_id: DEFAULT_PERSONA_ID,
            system_prompt: DEFAULT_SYSTEM_PROMPT,
            messages: [
              {
                role: 'user',
                content: `what is the minimum wage ${MOCK_COST_SENTINEL}`,
              },
            ],
          },
        },
      );
      expect(res.ok(), `complete: ${res.status()} ${await res.text()}`).toBe(true);
      const stream = await readWebSearchStream(res);
      expect(stream.deltaText).toBe(MOCK_WEB_SEARCH_REPLY);

      if (!metered) return;

      const txn = await newestUsageTransaction(user);
      // Provider cost * 22% margin * 0.88 fx ≈ CHF 0.0416, which alone rounds
      // to CHF 0.04 at whole-rappen granularity (the UsedProviderCost path).
      // The floor fee (CHF 0.009) pushes the total past the next rappen
      // boundary to CHF 0.05 — proving it is added REGARDLESS of the
      // provider-reported cost (spec §5.4 Decision 4, amended by the spike),
      // not skipped once a provider total is trusted.
      const providerCostOnlyCHF = MOCK_PROVIDER_COST_USD * 1.22 * 0.88; // default margin_bps / FX fallback
      expect(Math.round(providerCostOnlyCHF * 100)).toBe(4);
      expect(Math.abs(txn.amount_chf)).toBeCloseTo(0.05, 2);
    } finally {
      await user.api.dispose();
    }
  });
});
