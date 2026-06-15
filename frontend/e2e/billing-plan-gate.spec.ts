import { Page, expect, test } from '@playwright/test';

import {
  ConversationFixture,
  VaultFixture,
  buildConversationFixture,
  buildVaultFixture,
  seedAuthenticatedUnlockState,
} from './fixtures';

const API = 'http://localhost:8090';

// wireCommonRoutes stubs everything the chat shell needs to boot and unlock a
// single conversation, leaving the billing + complete endpoints to each test so
// they can drive the plan-gate states (trial / exhausted / inactive).
const wireCommonRoutes = async (
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

test('trial users see their remaining credit as a live pill near the composer', async ({
  page,
}) => {
  const userFixture = buildVaultFixture('user_trial', 'trial@example.com');
  const conversationFixture = buildConversationFixture(
    userFixture,
    'conv_trial_pill',
    'Trial pill',
  );
  await wireCommonRoutes(page, userFixture, conversationFixture, 'conv_trial_pill');

  await page.route(`${API}/api/v1/billing`, async (route) => {
    await route.fulfill({
      json: { plan_type: 'trial', balance_chf: 0.32, trial_seed_chf: 2.0 },
    });
  });

  await page.goto('/c/conv_trial_pill');

  // The pill surfaces the trial state up front so the user knows the credit is
  // finite before they ever hit a wall.
  await expect(page.getByText(/CHF\s*0\.32/).first()).toBeVisible();
  await expect(page.getByText(/trial/i).first()).toBeVisible();
});

test('exhausting the trial opens a plan-selection dialog instead of a generic error', async ({
  page,
}) => {
  const userFixture = buildVaultFixture('user_exhaust', 'exhaust@example.com');
  const conversationFixture = buildConversationFixture(
    userFixture,
    'conv_trial_exhaust',
    'Trial exhausted',
  );
  await wireCommonRoutes(page, userFixture, conversationFixture, 'conv_trial_exhaust');

  await page.route(`${API}/api/v1/billing`, async (route) => {
    await route.fulfill({
      json: { plan_type: 'trial', balance_chf: 0.02, trial_seed_chf: 2.0 },
    });
  });
  await page.route(
    `${API}/api/v1/conversations/conv_trial_exhaust/complete`,
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

  await page.goto('/c/conv_trial_exhaust');

  const composer = page.getByLabel('Message Cognos — encrypted on this device');
  await composer.fill('This should trip the plan gate');
  await page.getByRole('button', { name: 'Send' }).click();

  // A modal with the two plans — not just a toast. Both plan CTAs and the
  // annual upsell must be present (spec §13.2).
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await expect(dialog.getByText(/free trial/i).first()).toBeVisible();
  await expect(dialog.getByRole('button', { name: /pay-as-you-go/i })).toBeVisible();
  await expect(dialog.getByRole('button', { name: /unlimited/i })).toBeVisible();
  await expect(dialog.getByText(/CHF\s*10\.00/).first()).toBeVisible();
  await expect(dialog.getByText(/1000|1,000/).first()).toBeVisible();

  // The optimistic user message is rolled back — nothing was actually sent.
  await expect(page.getByText('This should trip the plan gate')).toHaveCount(0);
});

test('inactive users keep read access but the composer is locked', async ({ page }) => {
  const userFixture = buildVaultFixture('user_inactive', 'inactive@example.com');
  const conversationFixture = buildConversationFixture(
    userFixture,
    'conv_inactive',
    'Read only',
  );
  await wireCommonRoutes(page, userFixture, conversationFixture, 'conv_inactive');

  await page.route(`${API}/api/v1/billing`, async (route) => {
    await route.fulfill({ json: { plan_type: 'inactive' } });
  });

  await page.goto('/c/conv_inactive');

  // The conversation title (history) is still reachable.
  await expect(page.getByRole('heading', { name: 'Read only' })).toBeVisible();

  // Composer is disabled and a plan prompt is shown instead of letting the user
  // type into a dead end.
  const composer = page.getByLabel('Message Cognos — encrypted on this device');
  await expect(composer).toBeDisabled();
  await expect(page.getByText(/choose a plan/i)).toBeVisible();
});
