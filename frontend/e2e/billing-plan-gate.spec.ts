import { Page, expect, test } from '@playwright/test';

import {
  ConversationFixture,
  VaultFixture,
  buildConversationFixture,
  buildVaultFixture,
  seedAuthenticatedUnlockState,
} from './fixtures';

const API = 'http://localhost:8090';

// wireChatShell stubs everything the chat shell needs to boot and unlock a
// single conversation. The billing + complete endpoints are left to each test.
const wireChatShell = async (
  page: Page,
  userFixture: VaultFixture,
  conversationFixture: ConversationFixture,
  conversationId: string,
): Promise<void> => {
  await seedAuthenticatedUnlockState(page, userFixture);

  await page.route(`${API}/api/v1/user-key-pair`, async (route) => {
    await route.fulfill({ json: userFixture.userKeyPairRecord });
  });
  await page.route(`${API}/api/v1/vault-session`, async (route) => {
    await route.fulfill({ json: userFixture.vaultSession });
  });
  await page.route(`${API}/api/v1/user-preferences`, async (route) => {
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Not found' }),
    });
  });
  await page.route(`${API}/api/v1/models`, async (route) => {
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
  await page.route(`${API}/api/v1/conversations`, async (route) => {
    await route.fulfill({ json: [conversationFixture.conversationRecord] });
  });
  await page.route(
    `${API}/api/v1/conversations/${conversationId}/public-key`,
    async (route) => {
      await route.fulfill({ json: conversationFixture.conversationPublicKeyRecord });
    },
  );
  await page.route(
    `${API}/api/v1/conversations/${conversationId}/secret-key`,
    async (route) => {
      await route.fulfill({ json: conversationFixture.conversationSecretKeyRecord });
    },
  );
  await page.route(
    `${API}/api/v1/conversations/${conversationId}/messages?page=1&page_size=100`,
    async (route) => {
      await route.fulfill({
        json: { page: 1, perPage: 100, totalItems: 0, totalPages: 1, items: [] },
      });
    },
  );
};

test('active trial surfaces the credit card and an enabled composer', async ({
  page,
}) => {
  const userFixture = buildVaultFixture('user_trial', 'trial@example.com');
  const conversationFixture = buildConversationFixture(
    userFixture,
    'conv_trial',
    'Trial active',
  );
  await wireChatShell(page, userFixture, conversationFixture, 'conv_trial');
  await page.route(`${API}/api/v1/billing`, async (route) => {
    await route.fulfill({
      json: { plan_type: 'trial', balance_chf: 0.32, trial_seed_chf: 2.0 },
    });
  });

  await page.goto('/c/conv_trial');

  // The sidebar trial-credit card shows remaining credit against the seed.
  await expect(page.getByText('CHF 0.32 left of your CHF 2.00 trial')).toBeVisible();
  // New chat stays available while in credit.
  await expect(page.getByRole('button', { name: 'New chat' })).toBeEnabled();
  await expect(page.getByText('Used up')).toHaveCount(0);
});

test('exhausting the trial locks the composer and shows the in-chat banners', async ({
  page,
}) => {
  const userFixture = buildVaultFixture('user_exhaust', 'exhaust@example.com');
  const conversationFixture = buildConversationFixture(
    userFixture,
    'conv_exhaust',
    'Trial exhausted',
  );
  await wireChatShell(page, userFixture, conversationFixture, 'conv_exhaust');
  await page.route(`${API}/api/v1/billing`, async (route) => {
    await route.fulfill({
      json: { plan_type: 'trial', balance_chf: 0.02, trial_seed_chf: 2.0 },
    });
  });
  await page.route(
    `${API}/api/v1/conversations/conv_exhaust/complete`,
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

  // Wait for the conversation to load before typing (the composer is rebuilt
  // while the message list fetches).
  const messagesLoaded = page.waitForResponse((res) =>
    res.url().includes('/conversations/conv_exhaust/messages'),
  );
  await page.goto('/c/conv_exhaust');
  await messagesLoaded;
  await expect(
    page.getByText('Get started by sending a message using the composer below.'),
  ).toBeVisible();

  const composer = page.getByLabel(
    'Message Cognos — stored encrypted; sent to your provider to reply',
  );
  await composer.fill('This should trip the plan gate');
  await page.getByRole('button', { name: 'Send' }).click();

  // The in-chat lock banner + the locked composer both appear (no modal).
  await expect(page.getByText('Your trial credits are used up')).toBeVisible();
  await expect(page.getByText('Sending is paused')).toBeVisible();
  await expect(page.getByText('60-day refund window · cancel anytime')).toBeVisible();
  // New chat is disabled and the trial card flips to "Used up".
  await expect(page.getByRole('button', { name: 'New chat' })).toBeDisabled();
  await expect(page.getByText('Used up', { exact: true })).toBeVisible();
  // The optimistic user message was rolled back.
  await expect(page.getByText('This should trip the plan gate')).toHaveCount(0);
});

test('inactive users keep read access but cannot send', async ({ page }) => {
  const userFixture = buildVaultFixture('user_inactive', 'inactive@example.com');
  const conversationFixture = buildConversationFixture(
    userFixture,
    'conv_inactive',
    'Read only',
  );
  await wireChatShell(page, userFixture, conversationFixture, 'conv_inactive');
  await page.route(`${API}/api/v1/billing`, async (route) => {
    await route.fulfill({
      json: { plan_type: 'inactive', balance_chf: 0, trial_seed_chf: 0 },
    });
  });

  await page.goto('/c/conv_inactive');

  // History is still reachable.
  await expect(page.getByRole('heading', { name: 'Read only' })).toBeVisible();
  // Composer is replaced by the locked state; no text input is offered.
  await expect(page.getByText('Sending is paused')).toBeVisible();
  await expect(
    page.getByLabel(
      'Message Cognos — stored encrypted; sent to your provider to reply',
    ),
  ).toHaveCount(0);
  // No trial card for a non-trial plan.
  await expect(page.getByText('Trial credit')).toHaveCount(0);
});

test('a locked banner CTA opens the pricing page', async ({ page }) => {
  const userFixture = buildVaultFixture('user_price', 'price@example.com');
  const conversationFixture = buildConversationFixture(
    userFixture,
    'conv_price',
    'Pricing route',
  );
  await wireChatShell(page, userFixture, conversationFixture, 'conv_price');
  await page.route(`${API}/api/v1/billing`, async (route) => {
    await route.fulfill({
      json: { plan_type: 'inactive', balance_chf: 0, trial_seed_chf: 0 },
    });
  });

  await page.goto('/c/conv_price');

  await page.getByRole('button', { name: 'Choose a plan' }).click();
  await expect(page).toHaveURL(/\/pricing/);
  await expect(
    page.getByRole('heading', { name: 'Keep going, privately' }),
  ).toBeVisible();
});
