import { Page, expect, test } from '@playwright/test';

import {
  ConversationFixture,
  VaultFixture,
  buildConversationFixture,
  buildVaultFixture,
  seedAuthenticatedUnlockState,
} from './fixtures';

const API = 'http://localhost:8090';

interface ModelStub {
  id: string;
  name: string;
  input: number;
  output: number;
}

// wireChatShell stubs the chat shell's boot + unlock dependencies and the model
// catalogue (with tunable pricing so we can assert cost tiers). The billing
// endpoint is left to each test.
const wireChatShell = async (
  page: Page,
  userFixture: VaultFixture,
  conversationFixture: ConversationFixture,
  conversationId: string,
  models: ModelStub[],
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
        preferred_model_id: models[0]?.id,
        models: models.map((model) => ({
          id: model.id,
          name: model.name,
          slug: model.id,
          provider_id: 'infomaniak',
          provider_model_id: model.id,
          description: `${model.name} description`,
          privacy_tier: 'eu',
          tags: [],
          content_types: ['text'],
          input_context_tokens: 64000,
          max_output_tokens: 8192,
          pricing: {
            input_usd_per_million_tokens: model.input,
            output_usd_per_million_tokens: model.output,
          },
          is_eligible: true,
        })),
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

test('the sidebar profile button shows the plan and routes to billing', async ({
  page,
}) => {
  const userFixture = buildVaultFixture('user_profile', 'ewan.jones@example.com');
  const conversationFixture = buildConversationFixture(
    userFixture,
    'conv_profile',
    'Profile sidebar',
  );
  await wireChatShell(page, userFixture, conversationFixture, 'conv_profile', [
    { id: 'eu-model', name: 'EU Model', input: 1, output: 2 },
  ]);

  await page.route(`${API}/api/v1/billing`, async (route) => {
    await route.fulfill({
      json: {
        plan_type: 'trial',
        status: 'trial',
        balance_chf: 0.32,
        trial_seed_chf: 2.0,
      },
    });
  });
  await page.route(`${API}/api/v1/billing/usage`, async (route) => {
    await route.fulfill({
      json: { period_start: '2026-06-01T00:00:00Z', message_count: 0, by_model: [] },
    });
  });

  await page.goto('/c/conv_profile');

  const profile = page.getByRole('link', { name: /account & billing/i });
  await expect(profile).toBeVisible();
  // Plan label + privacy-preserving avatar initials (from the email local-part).
  await expect(profile.getByText('Trial', { exact: true })).toBeVisible();
  await expect(profile.getByText('EJ')).toBeVisible();
  // Trial credit is surfaced in the dedicated card above the profile.
  await expect(page.getByText('CHF 0.32 left of your CHF 2.00 trial')).toBeVisible();

  await profile.click();
  await expect(page).toHaveURL(/\/account\/billing/);
  // Profile opens the billing dashboard (not the pricing page).
  await expect(page.getByRole('heading', { name: 'Plan & billing' })).toBeVisible();
});

test('the model selector tags models with low/medium/high cost tiers', async ({
  page,
}) => {
  const userFixture = buildVaultFixture('user_tiers', 'tiers@example.com');
  const conversationFixture = buildConversationFixture(
    userFixture,
    'conv_tiers',
    'Cost tiers',
  );
  await wireChatShell(page, userFixture, conversationFixture, 'conv_tiers', [
    { id: 'cheap', name: 'Cheap Model', input: 0.2, output: 0.2 },
    { id: 'mid', name: 'Mid Model', input: 3, output: 15 },
    { id: 'pricey', name: 'Pricey Model', input: 15, output: 75 },
  ]);

  await page.route(`${API}/api/v1/billing`, async (route) => {
    await route.fulfill({
      json: { plan_type: 'trial', balance_chf: 2.0, trial_seed_chf: 2.0 },
    });
  });

  // The composer (and its model trigger) is rebuilt while fetching — wait for
  // the messages fetch to settle first.
  const messagesLoaded = page.waitForResponse((res) =>
    res.url().includes('/conversations/conv_tiers/messages'),
  );
  await page.goto('/c/conv_tiers');
  await messagesLoaded;
  await expect(
    page.getByText('Get started by sending a message using the composer below.'),
  ).toBeVisible();

  // Open the model selector (trigger shows the preferred model's name).
  await page.getByRole('button', { name: /Cheap Model/ }).click();

  const selector = page.getByRole('listbox', { name: /pick your ai model/i });
  await expect(selector).toBeVisible();

  // The explainer spells out that higher-cost models cost more.
  await expect(selector.getByText(/higher-cost models cost more/i)).toBeVisible();

  // Each model carries its derived tier chip.
  await expect(selector.getByText('Low cost')).toBeVisible();
  await expect(selector.getByText('Medium cost')).toBeVisible();
  await expect(selector.getByText('High cost')).toBeVisible();
});
