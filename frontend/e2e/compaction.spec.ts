import { expect, test } from '@playwright/test';

import {
  buildCompactionRecordFixture,
  buildConversationFixture,
  buildMessageRecordFixture,
  buildVaultFixture,
  seedAuthenticatedUnlockState,
} from './fixtures';

const COMPLETE_STREAM = (assistantId: string, userId: string) =>
  [
    `data: ${JSON.stringify({ type: 'delta', delta: 'Mocked reply' })}`,
    '',
    `data: ${JSON.stringify({
      type: 'complete',
      response: {
        user_message_id: userId,
        assistant_message: {
          id: assistantId,
          parent_message_id: userId,
          content: 'Mocked reply',
          persona_id: 'cognos:simple-assistant',
          model_id: 'eu-model',
          created_at: '2026-06-07T00:00:00Z',
        },
        usage: {
          // Real prompt-token count the planner now reads. 45 is below the
          // read-path model's threshold (0.7×64000) but above the trigger
          // model's tiny one (0.7×50 = 35), so only the trigger test fires.
          input_tokens: 45,
          output_tokens: 8,
          total_tokens: 53,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          cost_usd: 0.02,
          cost_chf: 0.02,
          cost_rappen: 2,
          used_provider_cost: true,
        },
      },
    })}`,
    '',
  ].join('\n');

const modelsResponse = (overrides: {
  inputContextTokens: number;
  charsPerToken?: number;
}) => ({
  privacy_tier: 'eu',
  preferred_model_id: 'eu-model',
  models: [
    {
      id: 'eu-model',
      name: 'EU Model',
      slug: 'eu-model',
      provider_id: 'infomaniak',
      provider_model_id: 'eu-model',
      description: 'Eligible model from the backend catalogue',
      privacy_tier: 'eu',
      tags: [{ title: 'switzerland' }],
      content_types: ['text'],
      input_context_tokens: overrides.inputContextTokens,
      max_output_tokens: 8192,
      pricing: { input_usd_per_million_tokens: 1, output_usd_per_million_tokens: 2 },
      eligible_for_compaction: true,
      approx_chars_per_token: overrides.charsPerToken ?? 0,
      is_eligible: true,
    },
  ],
});

test('reuses a persisted compaction: injects its summary and drops covered messages', async ({
  page,
}) => {
  const userFixture = buildVaultFixture('user_e2e_cmp', 'cmp@example.com');
  const conversationFixture = buildConversationFixture(
    userFixture,
    'conv_e2e_cmp',
    'Roadmap chat',
  );

  const m1 = buildMessageRecordFixture(conversationFixture, {
    id: 'msg_cmp_1',
    created: '2026-06-13T22:25:00Z',
    content: 'First question about the roadmap.',
    ownerId: userFixture.authState.model.id,
  });
  const m2 = buildMessageRecordFixture(conversationFixture, {
    id: 'msg_cmp_2',
    created: '2026-06-13T22:25:05Z',
    content: 'A long detailed roadmap answer.',
    personaId: 'cognos:simple-assistant',
    modelId: 'eu-model',
    parentMessageId: m1.id,
  });

  // A compaction covering the m1..m2 prefix, anchored at m2.
  const compaction = buildCompactionRecordFixture(conversationFixture, {
    id: 'cmp_1',
    created: '2026-06-13T22:25:10Z',
    payload: {
      version: '1',
      kind: 'conversation_compaction',
      conversation_id: 'conv_e2e_cmp',
      anchor_message_id: 'msg_cmp_2',
      covered_message_ids: ['msg_cmp_1', 'msg_cmp_2'],
      parent_compaction_id: '',
      compaction_level: 0,
      durable_memory: {
        facts: ['The roadmap was discussed [M1]'],
        decisions: [],
        open_threads: [],
        glossary: [],
      },
      rolling_narrative: 'SUMMARY_OF_ROADMAP_CHAT',
      citations: [{ label: 'M1', message_id: 'msg_cmp_1' }],
      source_token_estimate: 50,
      summary_token_estimate: 10,
      model_id: 'eu-model',
      prompt_version: 'compaction_v1',
      output_mode: 'delimited_text',
      created_at: '2026-06-13T22:25:10Z',
    },
  });

  let completeBody:
    | { context_summary?: string; messages: Array<{ role: string; content: string }> }
    | undefined;

  await seedAuthenticatedUnlockState(page, userFixture);
  await page.route('http://localhost:8090/api/v1/user-key-pair', async (route) => {
    await route.fulfill({ json: userFixture.userKeyPairRecord });
  });
  await page.route('http://localhost:8090/api/v1/vault-session', async (route) => {
    await route.fulfill({ json: userFixture.vaultSession });
  });
  await page.route('http://localhost:8090/api/v1/user-preferences', async (route) => {
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Not found' }),
    });
  });
  await page.route('http://localhost:8090/api/v1/models', async (route) => {
    await route.fulfill({ json: modelsResponse({ inputContextTokens: 64000 }) });
  });
  await page.route('http://localhost:8090/api/v1/conversations', async (route) => {
    await route.fulfill({ json: [conversationFixture.conversationRecord] });
  });
  await page.route(
    'http://localhost:8090/api/v1/conversations/conv_e2e_cmp/public-key',
    async (route) => {
      await route.fulfill({ json: conversationFixture.conversationPublicKeyRecord });
    },
  );
  await page.route(
    'http://localhost:8090/api/v1/conversations/conv_e2e_cmp/secret-key',
    async (route) => {
      await route.fulfill({ json: conversationFixture.conversationSecretKeyRecord });
    },
  );
  await page.route(
    'http://localhost:8090/api/v1/conversations/conv_e2e_cmp/messages?page=1&page_size=100',
    async (route) => {
      await route.fulfill({
        json: { page: 1, perPage: 100, totalItems: 2, totalPages: 1, items: [m1, m2] },
      });
    },
  );
  // GET returns the persisted compaction; POST is unused here.
  await page.route(
    'http://localhost:8090/api/v1/conversations/conv_e2e_cmp/compactions',
    async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ json: { items: [compaction] } });
        return;
      }
      await route.fulfill({ json: { ...compaction, skipped: true } });
    },
  );
  await page.route(
    'http://localhost:8090/api/v1/conversations/conv_e2e_cmp/complete',
    async (route) => {
      completeBody = route.request().postDataJSON();
      await route.fulfill({
        contentType: 'text/event-stream',
        body: COMPLETE_STREAM('msg_cmp_assistant_new', 'msg_cmp_user_new'),
      });
    },
  );

  // Register the wait BEFORE navigating: the compactions list loads during page
  // load, so the planner cache is populated before we send.
  const compactionsLoaded = page.waitForResponse((response) =>
    response.url().includes('/conv_e2e_cmp/compactions'),
  );
  await page.goto('/c/conv_e2e_cmp');
  await expect(page.getByRole('heading', { name: 'Roadmap chat' })).toBeVisible();
  await compactionsLoaded;

  const composer = page.getByLabel(
    'Message Cognos — stored encrypted; sent to your provider to reply',
  );
  await composer.fill('Follow-up question');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('Mocked reply')).toBeVisible();

  // The compaction summary was sent as context_summary, and the covered prefix
  // was NOT resent raw — only the new user turn remains in the messages array.
  expect(completeBody?.context_summary ?? '').toContain('SUMMARY_OF_ROADMAP_CHAT');
  const contents = (completeBody?.messages ?? []).map((m) => m.content);
  expect(contents).toContain('Follow-up question');
  expect(contents).not.toContain('First question about the roadmap.');
  expect(contents).not.toContain('A long detailed roadmap answer.');
});

test('triggers a background compaction once context passes the threshold', async ({
  page,
}) => {
  const userFixture = buildVaultFixture('user_e2e_trg', 'trg@example.com');
  const conversationFixture = buildConversationFixture(
    userFixture,
    'conv_e2e_trg',
    'Trigger chat',
  );

  // Two seeded messages whose combined length exceeds the (tiny) usable context,
  // so the post-response trigger fires deterministically.
  const m1 = buildMessageRecordFixture(conversationFixture, {
    id: 'msg_trg_1',
    created: '2026-06-13T22:25:00Z',
    content: 'A reasonably long opening user question that fills context.',
    ownerId: userFixture.authState.model.id,
  });
  const m2 = buildMessageRecordFixture(conversationFixture, {
    id: 'msg_trg_2',
    created: '2026-06-13T22:25:05Z',
    content: 'A reasonably long assistant answer that also fills the context.',
    personaId: 'cognos:simple-assistant',
    modelId: 'eu-model',
    parentMessageId: m1.id,
  });

  let compactionPost:
    | { model_id: string; anchor_message_id: string; messages: unknown[] }
    | undefined;

  await seedAuthenticatedUnlockState(page, userFixture);
  await page.route('http://localhost:8090/api/v1/user-key-pair', async (route) => {
    await route.fulfill({ json: userFixture.userKeyPairRecord });
  });
  await page.route('http://localhost:8090/api/v1/vault-session', async (route) => {
    await route.fulfill({ json: userFixture.vaultSession });
  });
  await page.route('http://localhost:8090/api/v1/user-preferences', async (route) => {
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Not found' }),
    });
  });
  // Tiny usable context (50 tokens, 1 char/token) so a couple of messages cross
  // the 70% trigger threshold.
  await page.route('http://localhost:8090/api/v1/models', async (route) => {
    await route.fulfill({
      json: modelsResponse({ inputContextTokens: 50, charsPerToken: 1 }),
    });
  });
  await page.route('http://localhost:8090/api/v1/conversations', async (route) => {
    await route.fulfill({ json: [conversationFixture.conversationRecord] });
  });
  await page.route(
    'http://localhost:8090/api/v1/conversations/conv_e2e_trg/public-key',
    async (route) => {
      await route.fulfill({ json: conversationFixture.conversationPublicKeyRecord });
    },
  );
  await page.route(
    'http://localhost:8090/api/v1/conversations/conv_e2e_trg/secret-key',
    async (route) => {
      await route.fulfill({ json: conversationFixture.conversationSecretKeyRecord });
    },
  );
  await page.route(
    'http://localhost:8090/api/v1/conversations/conv_e2e_trg/messages?page=1&page_size=100',
    async (route) => {
      await route.fulfill({
        json: { page: 1, perPage: 100, totalItems: 2, totalPages: 1, items: [m1, m2] },
      });
    },
  );
  await page.route(
    'http://localhost:8090/api/v1/conversations/conv_e2e_trg/compactions',
    async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({ json: { items: [] } });
        return;
      }
      // POST: capture the background compaction request and acknowledge it.
      compactionPost = route.request().postDataJSON();
      await route.fulfill({
        json: {
          id: 'cmp_created',
          conversation: 'conv_e2e_trg',
          data: 'unused',
          created: '2026-06-13T22:30:00Z',
          updated: '2026-06-13T22:30:00Z',
          skipped: true,
        },
      });
    },
  );
  await page.route(
    'http://localhost:8090/api/v1/conversations/conv_e2e_trg/complete',
    async (route) => {
      await route.fulfill({
        contentType: 'text/event-stream',
        body: COMPLETE_STREAM('msg_trg_assistant_new', 'msg_trg_user_new'),
      });
    },
  );

  await page.goto('/c/conv_e2e_trg');
  await expect(page.getByRole('heading', { name: 'Trigger chat' })).toBeVisible();

  const composer = page.getByLabel(
    'Message Cognos — stored encrypted; sent to your provider to reply',
  );
  // Register the POST wait BEFORE sending: the background compaction fires right
  // after the response completes.
  const postPromise = page.waitForRequest(
    (request) =>
      request.url().includes('/conv_e2e_trg/compactions') &&
      request.method() === 'POST',
  );
  await composer.fill('Another turn');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('Mocked reply')).toBeVisible();

  // The background compaction POST fires after the response, anchored at a real
  // message and carrying aliased source messages.
  const post = await postPromise;
  expect(post).toBeTruthy();
  expect(compactionPost?.model_id).toBe('eu-model');
  expect(compactionPost?.anchor_message_id).toBeTruthy();
  expect((compactionPost?.messages ?? []).length).toBeGreaterThanOrEqual(2);
});
