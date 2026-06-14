import { expect, test } from '@playwright/test';

import {
  buildConversationFixture,
  buildMessageRecordFixture,
  buildVaultFixture,
  seedAuthenticatedUnlockState,
} from './fixtures';

test('deleting a message replaces it with a tombstone and keeps the thread', async ({
  page,
}) => {
  const userFixture = buildVaultFixture('user_e2e_del', 'del@example.com');
  const conversationFixture = buildConversationFixture(
    userFixture,
    'conv_e2e_del',
    'Delete conversation',
  );

  const userMessage = buildMessageRecordFixture(conversationFixture, {
    id: 'msg_user_del',
    created: '2026-06-13T22:25:00Z',
    content: 'Tell me a secret.',
    ownerId: userFixture.authState.model.id,
  });
  const assistantMessage = buildMessageRecordFixture(conversationFixture, {
    id: 'msg_assistant_del',
    created: '2026-06-13T22:25:05Z',
    content: 'The secret answer.',
    agentId: 'cognos:simple-assistant',
    modelId: 'eu-model',
    parentMessageId: userMessage.id,
  });

  let patchedMessageId: string | undefined;
  let patchBody: { data?: string } | undefined;

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
            description: 'Eligible model from the backend catalogue',
            privacy_tier: 'eu',
            tags: [{ title: 'switzerland' }],
            content_types: ['text'],
            input_context_tokens: 64000,
            max_output_tokens: 8192,
            pricing: {
              input_usd_per_million_tokens: 1,
              output_usd_per_million_tokens: 2,
            },
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
    'http://localhost:8090/api/v1/conversations/conv_e2e_del/public-key',
    async (route) => {
      await route.fulfill({ json: conversationFixture.conversationPublicKeyRecord });
    },
  );
  await page.route(
    'http://localhost:8090/api/v1/conversations/conv_e2e_del/secret-key',
    async (route) => {
      await route.fulfill({ json: conversationFixture.conversationSecretKeyRecord });
    },
  );
  await page.route(
    'http://localhost:8090/api/v1/conversations/conv_e2e_del/messages?page=1&page_size=100',
    async (route) => {
      await route.fulfill({
        json: {
          page: 1,
          perPage: 100,
          totalItems: 2,
          totalPages: 1,
          items: [userMessage, assistantMessage],
        },
      });
    },
  );
  // Soft-delete PATCHes the message with a re-encrypted tombstone blob.
  await page.route(
    'http://localhost:8090/api/v1/messages/msg_assistant_del',
    async (route) => {
      if (route.request().method() === 'PATCH') {
        patchedMessageId = 'msg_assistant_del';
        patchBody = route.request().postDataJSON() as { data?: string };
        await route.fulfill({
          json: { id: 'msg_assistant_del', conversation: 'conv_e2e_del' },
        });
        return;
      }
      await route.continue();
    },
  );

  await page.goto('/c/conv_e2e_del');

  const assistant = page.locator('.message-list-item__assistant');
  await expect(assistant.getByText('The secret answer.')).toBeVisible();

  await assistant.hover();
  await assistant.getByRole('button', { name: 'Delete message' }).click();
  await page.getByRole('button', { name: 'Yes' }).click();

  // The original content is gone, replaced by a tombstone that stays in place.
  await expect(page.getByText('The secret answer.')).toHaveCount(0);
  await expect(assistant.getByText('Deleted message')).toBeVisible();
  // The user message is untouched, so the thread structure is preserved.
  await expect(page.getByText('Tell me a secret.')).toBeVisible();

  // A re-encrypted tombstone blob was sent — not a plaintext or empty body.
  expect(patchedMessageId).toBe('msg_assistant_del');
  expect(patchBody?.data).toBeTruthy();
  expect(patchBody?.data).not.toContain('secret');
});
