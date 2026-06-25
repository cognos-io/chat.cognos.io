import { expect, test } from '@playwright/test';

import {
  buildCompactionRecordFixture,
  buildConversationFixture,
  buildMessageRecordFixture,
  buildVaultFixture,
  seedAuthenticatedUnlockState,
} from './fixtures';

// Exercises the conversation-memory drawer end-to-end: it appears only when a
// compaction exists, shows the durable memory, and an edit re-encrypts and
// PATCHes the compaction (ciphertext only).
test('edits a conversation memory and persists re-encrypted ciphertext', async ({
  page,
}) => {
  const userFixture = buildVaultFixture('user_e2e_mem', 'mem@example.com');
  const conversationFixture = buildConversationFixture(
    userFixture,
    'conv_e2e_mem',
    'Memory chat',
  );

  const m1 = buildMessageRecordFixture(conversationFixture, {
    id: 'msg_mem_1',
    created: '2026-06-13T22:25:00Z',
    content: 'Earlier question.',
    ownerId: userFixture.authState.model.id,
  });
  const m2 = buildMessageRecordFixture(conversationFixture, {
    id: 'msg_mem_2',
    created: '2026-06-13T22:25:05Z',
    content: 'Earlier answer.',
    personaId: 'cognos:simple-assistant',
    modelId: 'eu-model',
    parentMessageId: m1.id,
  });

  const compaction = buildCompactionRecordFixture(conversationFixture, {
    id: 'cmp_mem_1',
    created: '2026-06-13T22:25:10Z',
    payload: {
      version: '1',
      kind: 'conversation_compaction',
      conversation_id: 'conv_e2e_mem',
      anchor_message_id: 'msg_mem_2',
      covered_message_ids: ['msg_mem_1', 'msg_mem_2'],
      parent_compaction_id: '',
      compaction_level: 0,
      durable_memory: {
        facts: ['User prefers Postgres'],
        decisions: ['Adopt pgx'],
        open_threads: [],
        glossary: [],
      },
      rolling_narrative: 'Discussed the database stack.',
      citations: [],
      source_token_estimate: 50,
      summary_token_estimate: 10,
      model_id: 'eu-model',
      prompt_version: 'compaction_v1',
      output_mode: 'delimited_text',
      created_at: '2026-06-13T22:25:10Z',
    },
  });

  let patchedData: string | undefined;

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
    'http://localhost:8090/api/v1/conversations/conv_e2e_mem/public-key',
    async (route) => {
      await route.fulfill({ json: conversationFixture.conversationPublicKeyRecord });
    },
  );
  await page.route(
    'http://localhost:8090/api/v1/conversations/conv_e2e_mem/secret-key',
    async (route) => {
      await route.fulfill({ json: conversationFixture.conversationSecretKeyRecord });
    },
  );
  await page.route(
    'http://localhost:8090/api/v1/conversations/conv_e2e_mem/messages?page=1&page_size=100',
    async (route) => {
      await route.fulfill({
        json: { page: 1, perPage: 100, totalItems: 2, totalPages: 1, items: [m1, m2] },
      });
    },
  );
  await page.route(
    'http://localhost:8090/api/v1/conversations/conv_e2e_mem/compactions',
    async (route) => {
      await route.fulfill({ json: { items: [compaction] } });
    },
  );
  await page.route(
    'http://localhost:8090/api/v1/conversation-compactions/cmp_mem_1',
    async (route) => {
      if (route.request().method() === 'PATCH') {
        patchedData = (route.request().postDataJSON() as { data?: string }).data;
        await route.fulfill({
          json: {
            id: 'cmp_mem_1',
            conversation: 'conv_e2e_mem',
            data: patchedData,
            created: '2026-06-13T22:25:10Z',
            updated: '2026-06-13T22:40:00Z',
          },
        });
        return;
      }
      await route.continue();
    },
  );

  const compactionsLoaded = page.waitForResponse((r) =>
    r.url().includes('/conv_e2e_mem/compactions'),
  );
  await page.goto('/c/conv_e2e_mem');
  await expect(page.getByRole('heading', { name: 'Memory chat' })).toBeVisible();
  await compactionsLoaded;

  // Open the header menu and the Memory drawer.
  await page.getByRole('button', { name: 'Conversation menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Memory' }).click();

  // The drawer shows the stored durable memory.
  await expect(page.getByText('Conversation memory')).toBeVisible();
  const facts = page.locator('#memory-facts');
  await expect(facts).toHaveValue('User prefers Postgres');
  await expect(page.locator('#memory-decisions')).toHaveValue('Adopt pgx');

  // Edit a fact and save.
  await facts.fill('User prefers Postgres\nDeploys on Infomaniak');
  await page.getByRole('button', { name: 'Save memory' }).click();

  // A re-encrypted (ciphertext) PATCH was sent — never the edited plaintext.
  await expect.poll(() => patchedData).toBeTruthy();
  expect(patchedData).not.toContain('Infomaniak');
  expect(patchedData).not.toContain('Postgres');
});
