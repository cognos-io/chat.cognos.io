import { Page, expect, test } from '@playwright/test';

import { buildVaultFixture, seedAuthenticatedUnlockState } from './fixtures';

const API = 'http://localhost:8090';

async function setupModelSelector(page: Page, planType: string) {
  const userFixture = buildVaultFixture(
    `user_cost_${planType}`,
    `${planType}@example.com`,
  );
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
  await page.route(`${API}/api/v1/personas`, async (route) => {
    await route.fulfill({ json: { items: [] } });
  });
  await page.route(`${API}/api/v1/conversations`, async (route) => {
    await route.fulfill({ json: [] });
  });
  await page.route(`${API}/api/v1/billing`, async (route) => {
    await route.fulfill({
      json: { plan_type: planType, status: 'active', balance_chf: 5 },
    });
  });
  await page.route(`${API}/api/v1/billing/usage`, async (route) => {
    await route.fulfill({
      json: { period_start: '2026-06-01T00:00:00Z', message_count: 0, by_model: [] },
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

  await page.goto('/');
  await page.getByRole('button', { name: 'EU Model' }).click();
  await expect(page.getByRole('listbox', { name: 'Pick your AI model' })).toBeVisible();
}

test('hides per-model cost framing on the unlimited plan', async ({ page }) => {
  await setupModelSelector(page, 'unlimited');

  await expect(page.locator('.model-selector__explainer')).toHaveCount(0);
  await expect(page.locator('.model-selector__cost')).toHaveCount(0);
});

test('shows per-model cost framing on a metered plan', async ({ page }) => {
  await setupModelSelector(page, 'payg');

  await expect(page.locator('.model-selector__explainer')).toBeVisible();
  await expect(page.locator('.model-selector__cost').first()).toBeVisible();
});
