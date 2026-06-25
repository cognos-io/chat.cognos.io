import { expect, test } from '@playwright/test';

import {
  buildConversationFixture,
  buildMessageRecordFixture,
  buildVaultFixture,
  seedAuthenticatedUnlockState,
} from './fixtures';

// Selecting text in a message and choosing "Add to memory" pins the snippet to
// the conversation's manual memory (a no-LLM ciphertext POST), and it is then
// injected as context_summary on the next send.
test('selecting message text adds it to memory and injects it on the next send', async ({
  page,
}) => {
  const userFixture = buildVaultFixture('user_e2e_add', 'add@example.com');
  const conversationFixture = buildConversationFixture(
    userFixture,
    'conv_e2e_add',
    'Pin chat',
  );

  const SNIPPET = 'I really like the dark theme option';

  const assistantMessage = buildMessageRecordFixture(conversationFixture, {
    id: 'msg_add_1',
    created: '2026-06-13T22:25:05Z',
    content: SNIPPET,
    personaId: 'cognos:simple-assistant',
    modelId: 'eu-model',
  });

  let manualData: string | undefined;
  let completeBody: { context_summary?: string } | undefined;

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
    'http://localhost:8090/api/v1/conversations/conv_e2e_add/public-key',
    async (route) => {
      await route.fulfill({ json: conversationFixture.conversationPublicKeyRecord });
    },
  );
  await page.route(
    'http://localhost:8090/api/v1/conversations/conv_e2e_add/secret-key',
    async (route) => {
      await route.fulfill({ json: conversationFixture.conversationSecretKeyRecord });
    },
  );
  await page.route(
    'http://localhost:8090/api/v1/conversations/conv_e2e_add/messages?page=1&page_size=100',
    async (route) => {
      await route.fulfill({
        json: {
          page: 1,
          perPage: 100,
          totalItems: 1,
          totalPages: 1,
          items: [assistantMessage],
        },
      });
    },
  );
  await page.route(
    'http://localhost:8090/api/v1/conversations/conv_e2e_add/compactions',
    async (route) => {
      await route.fulfill({ json: { items: [] } });
    },
  );
  // User memory is loaded on open and written when the User scope is chosen.
  let userData: string | undefined;
  await page.route('http://localhost:8090/api/v1/user-memory', async (route) => {
    if (route.request().method() === 'POST') {
      userData = (route.request().postDataJSON() as { data?: string }).data;
      await route.fulfill({
        json: {
          id: 'usrmem_1',
          data: userData,
          created: '2026-06-13T22:30:00Z',
          updated: '2026-06-13T22:30:00Z',
        },
      });
      return;
    }
    await route.fulfill({ json: { items: [] } });
  });
  await page.route(
    'http://localhost:8090/api/v1/conversations/conv_e2e_add/compactions/manual',
    async (route) => {
      manualData = (route.request().postDataJSON() as { data?: string }).data;
      await route.fulfill({
        json: {
          id: 'cmp_manual_1',
          conversation: 'conv_e2e_add',
          data: manualData,
          created: '2026-06-13T22:30:00Z',
          updated: '2026-06-13T22:30:00Z',
        },
      });
    },
  );
  await page.route(
    'http://localhost:8090/api/v1/conversations/conv_e2e_add/complete',
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

  await page.goto('/c/conv_e2e_add');
  await expect(page.getByRole('heading', { name: 'Pin chat' })).toBeVisible();

  // Select the snippet text in the rendered message and raise the scope menu.
  const snippet = page.getByText(SNIPPET);
  await expect(snippet).toBeVisible();
  await snippet.selectText();
  await snippet.dispatchEvent('mouseup');

  // A non-project conversation offers Conversation + User, but not Project.
  const menu = page.locator('.message-list-item__memory-pop');
  await expect(
    menu.getByRole('button', { name: 'Conversation', exact: true }),
  ).toBeVisible();
  await expect(menu.getByRole('button', { name: 'User', exact: true })).toBeVisible();
  await expect(menu.getByRole('button', { name: 'Project', exact: true })).toHaveCount(
    0,
  );

  // Pin to conversation memory — confirm a ciphertext-only manual POST fired.
  await menu.getByRole('button', { name: 'Conversation', exact: true }).click();
  await expect.poll(() => manualData).toBeTruthy();
  expect(manualData).not.toContain('dark theme');
  await expect(page.getByText('Added to memory')).toBeVisible();

  // The pinned snippet is now injected as context_summary on the next send.
  const composer = page.getByLabel(
    'Message Cognos — stored encrypted; sent to your provider to reply',
  );
  await composer.fill('Remind me what I like');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect.poll(() => completeBody?.context_summary ?? '').toContain(SNIPPET);

  // Pinning the same selection to User memory writes a ciphertext-only POST.
  await snippet.selectText();
  await snippet.dispatchEvent('mouseup');
  await menu.getByRole('button', { name: 'User', exact: true }).click();
  await expect.poll(() => userData).toBeTruthy();
  expect(userData).not.toContain('dark theme');
});
