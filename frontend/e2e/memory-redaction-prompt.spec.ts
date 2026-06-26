import { expect, test } from '@playwright/test';

import {
  buildCompactionRecordFixture,
  buildConversationFixture,
  buildMessageRecordFixture,
  buildVaultFixture,
  seedAuthenticatedUnlockState,
} from './fixtures';

// When the (only) redaction placeholders live in the injected memory — not in any
// raw message — the system prompt must still carry the preserve-placeholders
// instruction so the model honours the tokens.
test('memory-only redaction placeholders extend the system prompt', async ({
  page,
}) => {
  const userFixture = buildVaultFixture('user_e2e_mr', 'mr@example.com');
  const conversationFixture = buildConversationFixture(
    userFixture,
    'conv_e2e_mr',
    'Memory redaction chat',
  );

  const m1 = buildMessageRecordFixture(conversationFixture, {
    id: 'msg_mr_1',
    created: '2026-06-13T22:25:00Z',
    content: 'A perfectly ordinary message with no sensitive values.',
    ownerId: userFixture.authState.model.id,
  });

  // Manual memory holding a redaction placeholder (and nothing sensitive in the
  // raw messages).
  const manual = buildCompactionRecordFixture(conversationFixture, {
    id: 'cmp_mr_manual',
    created: '2026-06-13T22:25:10Z',
    payload: {
      version: '1',
      kind: 'conversation_compaction',
      conversation_id: 'conv_e2e_mr',
      anchor_message_id: '',
      covered_message_ids: [],
      parent_compaction_id: '',
      compaction_level: 0,
      durable_memory: { items: ['Work email is [[PII_EMAIL_A8F2KD]]'] },
      rolling_narrative: '',
      citations: [],
      source_token_estimate: 0,
      summary_token_estimate: 0,
      model_id: '',
      prompt_version: 'manual_v1',
      output_mode: 'manual',
      created_at: '2026-06-13T22:25:10Z',
    },
  });

  let completeBody: { system_prompt?: string; context_summary?: string } | undefined;

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
    await route.fulfill({
      json: {
        privacy_tier: 'eu',
        preferred_model_id: 'eu-model',
        models: [
          {
            id: 'eu-model',
            name: 'EU Model',
            slug: 'eu-model',
            provider_id: 'infomaniak',
            provider_model_id: 'eu-model',
            description: 'Eligible model',
            privacy_tier: 'eu',
            tags: [{ title: 'switzerland' }],
            content_types: ['text'],
            input_context_tokens: 64000,
            max_output_tokens: 8192,
            pricing: {
              input_usd_per_million_tokens: 1,
              output_usd_per_million_tokens: 2,
            },
            eligible_for_compaction: true,
            is_eligible: true,
          },
        ],
      },
    });
  });
  await page.route('http://localhost:8090/api/v1/conversations', async (route) => {
    await route.fulfill({ json: [conversationFixture.conversationRecord] });
  });
  await page.route(
    'http://localhost:8090/api/v1/conversations/conv_e2e_mr/public-key',
    async (route) => {
      await route.fulfill({ json: conversationFixture.conversationPublicKeyRecord });
    },
  );
  await page.route(
    'http://localhost:8090/api/v1/conversations/conv_e2e_mr/secret-key',
    async (route) => {
      await route.fulfill({ json: conversationFixture.conversationSecretKeyRecord });
    },
  );
  await page.route(
    'http://localhost:8090/api/v1/conversations/conv_e2e_mr/messages?page=1&page_size=100',
    async (route) => {
      await route.fulfill({
        json: { page: 1, perPage: 100, totalItems: 1, totalPages: 1, items: [m1] },
      });
    },
  );
  await page.route(
    'http://localhost:8090/api/v1/conversations/conv_e2e_mr/compactions',
    async (route) => {
      await route.fulfill({ json: { items: [manual] } });
    },
  );
  await page.route(
    'http://localhost:8090/api/v1/conversations/conv_e2e_mr/complete',
    async (route) => {
      completeBody = route.request().postDataJSON();
      await route.fulfill({
        contentType: 'text/event-stream',
        body: [
          `data: ${JSON.stringify({ type: 'delta', delta: 'ok' })}`,
          '',
          `data: ${JSON.stringify({
            type: 'complete',
            response: {
              user_message_id: 'u2',
              assistant_message: {
                id: 'a2',
                parent_message_id: 'u2',
                content: 'ok',
                persona_id: 'cognos:simple-assistant',
                model_id: 'eu-model',
                created_at: '2026-06-07T00:00:00Z',
              },
              usage: {
                input_tokens: 10,
                output_tokens: 2,
                total_tokens: 12,
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: 0,
                cost_usd: 0,
                cost_chf: 0,
                cost_rappen: 0,
                used_provider_cost: false,
              },
            },
          })}`,
          '',
        ].join('\n'),
      });
    },
  );

  const compactionsLoaded = page.waitForResponse((r) =>
    r.url().includes('/conv_e2e_mr/compactions'),
  );
  await page.goto('/c/conv_e2e_mr');
  await expect(
    page.getByRole('heading', { name: 'Memory redaction chat' }),
  ).toBeVisible();
  await compactionsLoaded;

  const composer = page.getByLabel(
    'Message Cognos — stored encrypted; sent to your provider to reply',
  );
  await composer.fill('What is my email?');
  await page.getByRole('button', { name: 'Send' }).click();

  await expect
    .poll(() => completeBody?.context_summary ?? '')
    .toContain('[[PII_EMAIL_A8F2KD]]');
  // The placeholder lived only in memory, yet the preserve-placeholders
  // instruction is present in the system prompt.
  expect(completeBody?.system_prompt ?? '').toContain('Preserve these placeholders');
});
