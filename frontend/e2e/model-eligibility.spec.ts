import { expect, test } from '@playwright/test';

import {
  buildConversationFixture,
  buildVaultFixture,
  seedAuthenticatedUnlockState,
} from './fixtures';

test('authenticated user cannot send with an unavailable model', async ({ page }) => {
  const userFixture = buildVaultFixture('user_e2e', 'e2e@example.com');
  const conversationFixture = buildConversationFixture(
    userFixture,
    'conv_e2e_ineligible',
    'Locked-down workspace',
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
        models: [
          {
            id: 'global-model',
            name: 'Global Model',
            slug: 'global-model',
            provider_id: 'global-provider',
            provider_model_id: 'global-model',
            description: 'Unavailable for this user',
            privacy_tier: 'global',
            tags: [{ title: 'general-purpose' }],
            content_types: ['text'],
            input_context_tokens: 32000,
            pricing: {
              input_usd_per_million_tokens: 1,
              output_usd_per_million_tokens: 2,
            },
            is_eligible: false,
            ineligibility_reason: 'model privacy tier exceeds user privacy tier',
          },
        ],
      },
    });
  });

  await page.route('http://localhost:8090/api/v1/conversations', async (route) => {
    await route.fulfill({ json: [conversationFixture.conversationRecord] });
  });

  await page.route(
    'http://localhost:8090/api/v1/conversations/conv_e2e_ineligible/public-key',
    async (route) => {
      await route.fulfill({ json: conversationFixture.conversationPublicKeyRecord });
    },
  );

  await page.route(
    'http://localhost:8090/api/v1/conversations/conv_e2e_ineligible/secret-key',
    async (route) => {
      await route.fulfill({ json: conversationFixture.conversationSecretKeyRecord });
    },
  );

  await page.route(
    'http://localhost:8090/api/v1/conversations/conv_e2e_ineligible/messages?page=1&page_size=100',
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

  let completionRequested = false;
  await page.route(
    'http://localhost:8090/api/v1/conversations/conv_e2e_ineligible/complete',
    async (route) => {
      completionRequested = true;
      await route.fulfill({ status: 500, body: 'unexpected completion request' });
    },
  );

  await page.goto('/c/conv_e2e_ineligible');

  await expect(
    page.getByRole('heading', { name: 'Locked-down workspace' }),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Global Model' })).toBeVisible();

  await page.getByRole('button', { name: 'Global Model' }).click();
  await expect(
    page.getByRole('option', { name: /Global Model.*Needs Global processing/ }),
  ).toBeDisabled();

  const composer = page.getByLabel(
    'Message Cognos — stored encrypted; sent to your provider to reply',
  );
  await composer.fill('This should never send');

  const sendButton = page.getByRole('button', { name: 'Send' });
  await expect(sendButton).toBeDisabled();

  expect(completionRequested).toBe(false);
  await expect(page.getByText('This should never send')).toHaveCount(0);
});
