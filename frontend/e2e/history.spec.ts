import { expect, test } from '@playwright/test';

import {
  buildConversationFixture,
  buildMessageRecordFixture,
  buildVaultFixture,
  seedAuthenticatedUnlockState,
} from './fixtures';

test('authenticated user reloads and still sees decrypted history', async ({
  page,
}) => {
  const userFixture = buildVaultFixture('user_e2e', 'e2e@example.com');
  const conversationFixture = buildConversationFixture(
    userFixture,
    'conv_e2e_history',
    'Sprint review',
  );
  const createdAt = '2026-06-07T00:00:00Z';
  const userMessage = buildMessageRecordFixture(conversationFixture, {
    id: 'msg_user_history',
    created: createdAt,
    content: 'What shipped this week?',
    ownerId: userFixture.authState.model.id,
  });
  const assistantMessage = buildMessageRecordFixture(conversationFixture, {
    id: 'msg_assistant_history',
    created: '2026-06-07T00:00:05Z',
    content: 'We shipped the gateway seam and the new browser tests.',
    agentId: 'cognos:simple-assistant',
    modelId: 'eu-model',
    parentMessageId: userMessage.id,
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
    'http://localhost:8090/api/v1/conversations/conv_e2e_history/public-key',
    async (route) => {
      await route.fulfill({ json: conversationFixture.conversationPublicKeyRecord });
    },
  );

  await page.route(
    'http://localhost:8090/api/v1/conversations/conv_e2e_history/secret-key',
    async (route) => {
      await route.fulfill({ json: conversationFixture.conversationSecretKeyRecord });
    },
  );

  await page.route(
    'http://localhost:8090/api/v1/conversations/conv_e2e_history/messages?page=1&page_size=100',
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

  await page.goto('/c/conv_e2e_history');

  await expect(page.getByRole('heading', { name: 'Sprint review' })).toBeVisible();
  await expect(page.getByText('What shipped this week?')).toBeVisible();
  await expect(
    page.getByText('We shipped the gateway seam and the new browser tests.'),
  ).toBeVisible();

  await page.reload();

  await expect(page.getByRole('heading', { name: 'Sprint review' })).toBeVisible();
  await expect(page.getByText('What shipped this week?')).toBeVisible();
  await expect(
    page.getByText('We shipped the gateway seam and the new browser tests.'),
  ).toBeVisible();
});
