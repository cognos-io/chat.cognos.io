import { expect, test } from '@playwright/test';

import {
  buildConversationFixture,
  buildVaultFixture,
  seedAuthenticatedUnlockState,
} from './fixtures';

test('authenticated user sees trial exhaustion feedback when billing blocks send', async ({
  page,
}) => {
  const userFixture = buildVaultFixture('user_e2e', 'e2e@example.com');
  const conversationFixture = buildConversationFixture(
    userFixture,
    'conv_e2e_trial_blocked',
    'Trial exhausted',
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

  await page.route('http://localhost:8090/api/v1/billing', async (route) => {
    await route.fulfill({ json: { plan_type: 'trial', balance_chf: 0.02 } });
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
    'http://localhost:8090/api/v1/conversations/conv_e2e_trial_blocked/public-key',
    async (route) => {
      await route.fulfill({ json: conversationFixture.conversationPublicKeyRecord });
    },
  );

  await page.route(
    'http://localhost:8090/api/v1/conversations/conv_e2e_trial_blocked/secret-key',
    async (route) => {
      await route.fulfill({ json: conversationFixture.conversationSecretKeyRecord });
    },
  );

  await page.route(
    'http://localhost:8090/api/v1/conversations/conv_e2e_trial_blocked/messages?page=1&page_size=100',
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
    'http://localhost:8090/api/v1/conversations/conv_e2e_trial_blocked/complete',
    async (route) => {
      await route.fulfill({
        status: 402,
        contentType: 'application/json',
        body: JSON.stringify({
          error: 'TRIAL_EXHAUSTED',
          message: 'Your free trial has been used up.',
          balance_chf: 0.02,
          estimated_cost_chf: 0.32,
          next_step: 'subscribe',
        }),
      });
    },
  );

  await page.goto('/c/conv_e2e_trial_blocked');

  await expect(page.getByRole('heading', { name: 'Trial exhausted' })).toBeVisible();

  const composer = page.getByLabel('Message Cognos — encrypted on this device');
  await composer.fill('This should be blocked by billing');
  await page.getByRole('button', { name: 'Send' }).click();

  // A trial-exhausted 402 opens the plan-selection dialog (not a generic toast)
  // and rolls back the optimistic message.
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/free trial/i).first()).toBeVisible();
  await expect(page.getByText('This should be blocked by billing')).toHaveCount(0);
});
