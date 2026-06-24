import { Page, expect, test } from '@playwright/test';

import { buildVaultFixture, seedAuthenticatedUnlockState } from './fixtures';

const API = 'http://localhost:8090';

// A small catalogue exercising discovery: a curated-recommended default
// (gemini-3-5-flash), a powerful model, and an image-generation model.
const MODELS = [
  {
    id: 'gemini-3-5-flash',
    name: 'Gemini Flash',
    slug: 'gemini-3-5-flash',
    provider_id: 'requesty',
    provider_model_id: 'gemini-3-5-flash',
    description: 'Fast everyday model',
    privacy_tier: 'eu',
    tags: [],
    content_types: ['text'],
    input_context_tokens: 1_000_000,
    pricing: { input_usd_per_million_tokens: 1, output_usd_per_million_tokens: 2 },
    is_eligible: true,
  },
  {
    id: 'claude-opus',
    name: 'Claude Opus',
    slug: 'claude-opus',
    provider_id: 'requesty',
    provider_model_id: 'claude-opus',
    description: 'Powerful reasoning model',
    privacy_tier: 'eu',
    tags: [],
    content_types: ['text'],
    input_context_tokens: 200_000,
    pricing: { input_usd_per_million_tokens: 15, output_usd_per_million_tokens: 75 },
    is_eligible: true,
  },
  {
    id: 'pixel-paint',
    name: 'Pixel Paint',
    slug: 'pixel-paint',
    provider_id: 'requesty',
    provider_model_id: 'pixel-paint',
    description: 'Generates images',
    privacy_tier: 'eu',
    tags: [],
    content_types: ['text'],
    input_context_tokens: 64_000,
    pricing: { input_usd_per_million_tokens: 1, output_usd_per_million_tokens: 2 },
    supports_image_generation: true,
    is_eligible: true,
  },
];

// setup seeds an authenticated, unlocked session with the catalogue above and
// returns a counter of how many times /api/v1/models was fetched, so a test can
// assert that searching never hits the network.
async function setup(page: Page): Promise<{ modelCalls: () => number }> {
  const userFixture = buildVaultFixture('user_discovery', 'discovery@example.com');
  await seedAuthenticatedUnlockState(page, userFixture);

  await page.route(`${API}/api/v1/user-key-pair`, (route) =>
    route.fulfill({ json: userFixture.userKeyPairRecord }),
  );
  await page.route(`${API}/api/v1/vault-session`, (route) =>
    route.fulfill({ json: userFixture.vaultSession }),
  );
  await page.route(`${API}/api/v1/user-preferences`, (route) =>
    route.fulfill({ status: 404, json: { message: 'Not found' } }),
  );
  await page.route(`${API}/api/v1/personas`, (route) =>
    route.fulfill({ json: { items: [] } }),
  );
  await page.route(`${API}/api/v1/conversations`, (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route(`${API}/api/v1/billing`, (route) =>
    route.fulfill({ json: { plan_type: 'payg', status: 'active', balance_chf: 5 } }),
  );
  await page.route(`${API}/api/v1/billing/usage`, (route) =>
    route.fulfill({
      json: { period_start: '2026-06-01T00:00:00Z', message_count: 0, by_model: [] },
    }),
  );

  let modelCalls = 0;
  await page.route(`${API}/api/v1/models`, (route) => {
    modelCalls += 1;
    return route.fulfill({ json: { privacy_tier: 'eu', models: MODELS } });
  });

  await page.goto('/');
  return { modelCalls: () => modelCalls };
}

const openSelector = async (page: Page) => {
  // The trigger shows the active model's name (the recommended default).
  await page.getByRole('button', { name: 'Gemini Flash' }).click();
  await expect(page.getByRole('listbox', { name: 'Pick your AI model' })).toBeVisible();
};

test('a fresh user lands on the recommended default without opening the selector', async ({
  page,
}) => {
  await setup(page);
  // No preference/project default set, so resolution picks the recommended
  // eligible model (gemini-3-5-flash) — its name shows on the composer trigger.
  await expect(page.getByRole('button', { name: 'Gemini Flash' })).toBeVisible();
});

test('searching by name narrows the list and runs entirely client-side', async ({
  page,
}) => {
  const { modelCalls } = await setup(page);
  await openSelector(page);
  const callsAfterOpen = modelCalls();

  await page.locator('.model-selector__search-input').fill('opus');

  await expect(page.getByRole('option', { name: /Claude Opus/ })).toBeVisible();
  await expect(page.getByRole('option', { name: /Gemini Flash/ })).toHaveCount(0);

  // No extra catalogue fetch while typing — search is local (spec §4.1).
  expect(modelCalls()).toBe(callsAfterOpen);
});

test('the Image filter shows only image-generation models', async ({ page }) => {
  await setup(page);
  await openSelector(page);

  await page.locator('.model-selector__chip', { hasText: 'Image' }).click();

  await expect(page.getByRole('option', { name: /Pixel Paint/ })).toBeVisible();
  await expect(page.getByRole('option', { name: /Gemini Flash/ })).toHaveCount(0);
});

test('Escape closes the selector', async ({ page }) => {
  await setup(page);
  await openSelector(page);

  await page.locator('.model-selector__search-input').press('Escape');

  await expect(page.getByRole('listbox', { name: 'Pick your AI model' })).toHaveCount(
    0,
  );
});
