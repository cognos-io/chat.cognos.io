import { expect, test } from '@playwright/test';

import {
  buildCompactionRecordFixture,
  buildConversationFixture,
  buildMessageRecordFixture,
  buildVaultFixture,
  seedAuthenticatedUnlockState,
} from './fixtures';

// On a handset viewport the conversation-memory drawer becomes a full-screen
// sheet (slides up from the bottom) rather than the desktop side panel.
test.use({ viewport: { width: 390, height: 844 } });

test('opens the conversation memory as a full-screen sheet on mobile', async ({
  page,
}) => {
  const userFixture = buildVaultFixture('user_e2e_sheet', 'sheet@example.com');
  const conversationFixture = buildConversationFixture(
    userFixture,
    'conv_e2e_sheet',
    'Sheet chat',
  );

  const m1 = buildMessageRecordFixture(conversationFixture, {
    id: 'msg_sheet_1',
    created: '2026-06-13T22:25:00Z',
    content: 'Earlier message.',
    ownerId: userFixture.authState.model.id,
  });
  const compaction = buildCompactionRecordFixture(conversationFixture, {
    id: 'cmp_sheet_1',
    created: '2026-06-13T22:25:10Z',
    payload: {
      version: '1',
      kind: 'conversation_compaction',
      conversation_id: 'conv_e2e_sheet',
      anchor_message_id: 'msg_sheet_1',
      covered_message_ids: ['msg_sheet_1'],
      parent_compaction_id: '',
      compaction_level: 0,
      durable_memory: {
        facts: ['Prefers mobile'],
        decisions: [],
        open_threads: [],
        glossary: [],
      },
      rolling_narrative: 'A short chat.',
      citations: [],
      source_token_estimate: 10,
      summary_token_estimate: 5,
      model_id: 'eu-model',
      prompt_version: 'compaction_v1',
      output_mode: 'delimited_text',
      created_at: '2026-06-13T22:25:10Z',
    },
  });

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
    'http://localhost:8090/api/v1/conversations/conv_e2e_sheet/public-key',
    async (route) => {
      await route.fulfill({ json: conversationFixture.conversationPublicKeyRecord });
    },
  );
  await page.route(
    'http://localhost:8090/api/v1/conversations/conv_e2e_sheet/secret-key',
    async (route) => {
      await route.fulfill({ json: conversationFixture.conversationSecretKeyRecord });
    },
  );
  await page.route(
    'http://localhost:8090/api/v1/conversations/conv_e2e_sheet/messages?page=1&page_size=100',
    async (route) => {
      await route.fulfill({
        json: { page: 1, perPage: 100, totalItems: 1, totalPages: 1, items: [m1] },
      });
    },
  );
  await page.route(
    'http://localhost:8090/api/v1/conversations/conv_e2e_sheet/compactions',
    async (route) => {
      await route.fulfill({ json: { items: [compaction] } });
    },
  );

  const compactionsLoaded = page.waitForResponse((r) =>
    r.url().includes('/conv_e2e_sheet/compactions'),
  );
  await page.goto('/c/conv_e2e_sheet');
  await expect(page.getByRole('heading', { name: 'Sheet chat' })).toBeVisible();
  await compactionsLoaded;

  await page.getByRole('button', { name: 'Conversation menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Memory' }).click();

  await expect(page.getByText('Conversation memory')).toBeVisible();

  // The sheet fills the viewport edge to edge.
  const box = await page.locator('.cog-dialog-surface').boundingBox();
  expect(box?.width).toBeGreaterThanOrEqual(389);
  expect(box?.height).toBeGreaterThanOrEqual(800);
});
