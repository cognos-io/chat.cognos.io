import { expect, test } from '@playwright/test';

import {
  buildConversationFixture,
  buildVaultFixture,
  seedAuthenticatedUnlockState,
} from './fixtures';

test('authenticated user sends a message and receives a response', async ({ page }) => {
  const userFixture = buildVaultFixture('user_e2e', 'e2e@example.com');
  const conversationFixture = buildConversationFixture(
    userFixture,
    'conv_e2e_1',
    'Quarterly planning',
  );

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
    'http://localhost:8090/api/v1/conversations/conv_e2e_1/public-key',
    async (route) => {
      await route.fulfill({ json: conversationFixture.conversationPublicKeyRecord });
    },
  );

  await page.route(
    'http://localhost:8090/api/v1/conversations/conv_e2e_1/secret-key',
    async (route) => {
      await route.fulfill({ json: conversationFixture.conversationSecretKeyRecord });
    },
  );

  await page.route(
    'http://localhost:8090/api/v1/conversations/conv_e2e_1/messages?page=1&page_size=100',
    async (route) => {
      await route.fulfill({
        json: {
          page: 1,
          perPage: 100,
          totalItems: 0,
          totalPages: 1,
          items: [],
        },
      });
    },
  );

  await page.route(
    'http://localhost:8090/api/v1/conversations/conv_e2e_1/complete',
    async (route) => {
      const request = route.request();
      const body = request.postDataJSON() as {
        model_id: string;
        persona_id: string;
        messages: Array<{ role: string; content: string }>;
      };

      expect(body.model_id).toBe('eu-model');
      expect(body.persona_id).toBe('cognos:simple-assistant');
      expect(body.messages.at(-1)).toMatchObject({
        role: 'user',
        content: 'Hello from e2e',
      });

      await route.fulfill({
        contentType: 'text/event-stream',
        body: [
          `data: ${JSON.stringify({ type: 'delta', delta: 'Hi from the mocked backend' })}`,
          '',
          `data: ${JSON.stringify({
            type: 'complete',
            response: {
              user_message_id: 'msg_user_1',
              assistant_message: {
                id: 'msg_assistant_1',
                parent_message_id: 'msg_user_1',
                content: 'Hi from the mocked backend',
                persona_id: 'cognos:simple-assistant',
                model_id: 'eu-model',
                created_at: '2026-06-07T00:00:00Z',
              },
              usage: {
                input_tokens: 12,
                output_tokens: 8,
                total_tokens: 20,
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
        ].join('\n'),
      });
    },
  );

  await page.goto('/c/conv_e2e_1');

  await expect(page.getByRole('heading', { name: 'Quarterly planning' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'EU Model' })).toBeVisible();

  const composer = page.getByLabel('Message Cognos — encrypted on this device');
  await composer.fill('Hello from e2e');
  await page.getByRole('button', { name: 'Send' }).click();

  await expect(page.getByText('Hello from e2e')).toBeVisible();
  await expect(page.getByText('Hi from the mocked backend')).toBeVisible();
});
