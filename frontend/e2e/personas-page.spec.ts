import { expect, test } from '@playwright/test';

import { buildVaultFixture, seedAuthenticatedUnlockState } from './fixtures';

const API = 'http://localhost:8090';

const billingResponse = {
  plan_type: 'trial',
  status: 'active',
  balance_chf: 5,
  trial_seed_chf: 5,
};

const modelsResponse = {
  privacy_tier: 'eu',
  preferred_model_id: 'eu-model',
  models: [
    {
      id: 'eu-model',
      name: 'EU Model',
      slug: 'eu-model',
      provider_id: 'infomaniak',
      provider_model_id: 'eu-model',
      description: 'Eligible model',
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
};

test('browses, searches, activates and pins personas on the personas page', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  const userFixture = buildVaultFixture('user_e2e_page', 'page@example.com');

  await seedAuthenticatedUnlockState(page, userFixture);

  await page.route(`${API}/api/v1/user-key-pair`, async (route) => {
    await route.fulfill({ json: userFixture.userKeyPairRecord });
  });
  await page.route(`${API}/api/v1/vault-session`, async (route) => {
    await route.fulfill({ json: userFixture.vaultSession });
  });
  await page.route(`${API}/api/v1/billing`, async (route) => {
    await route.fulfill({ json: billingResponse });
  });
  await page.route(`${API}/api/v1/models`, async (route) => {
    await route.fulfill({ json: modelsResponse });
  });
  await page.route(`${API}/api/v1/projects`, async (route) => {
    await route.fulfill({ json: [] });
  });
  await page.route(`${API}/api/v1/personas`, async (route) => {
    await route.fulfill({ json: { items: [] } });
  });
  await page.route(`${API}/api/v1/conversations`, async (route) => {
    await route.fulfill({ json: [] });
  });

  // No preferences yet; echo the encrypted payload back on write so the client
  // can decrypt its own data without the test reproducing the keypair box.
  await page.route(`${API}/api/v1/user-preferences`, async (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as { data: string };
      await route.fulfill({ status: 201, json: { id: 'prefs_e2e', data: body.data } });
      return;
    }
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Not found' }),
    });
  });
  await page.route(`${API}/api/v1/user-preferences/prefs_e2e`, async (route) => {
    const body = route.request().postDataJSON() as { data: string };
    await route.fulfill({ json: { id: 'prefs_e2e', data: body.data } });
  });

  await page.goto('/personas');

  await expect(
    page.getByRole('heading', { name: 'Personas', exact: true }),
  ).toBeVisible();

  // The seven bundled official personas appear under the Official section.
  // Scope by the section heading so the "Official" badge text on cards in other
  // sections (e.g. Recently used) doesn't also match.
  const officialSection = page.locator('.personas-page__section').filter({
    has: page.locator('.personas-page__section-heading', { hasText: 'Official' }),
  });
  await expect(officialSection.getByText('Simple Assistant')).toBeVisible();
  await expect(officialSection.getByText('Socratic Tutor')).toBeVisible();
  await expect(officialSection.getByText('Researcher')).toBeVisible();

  // Search filters by name across all personas.
  await page.getByLabel('Search personas').fill('socratic');
  await expect(
    page.locator('.persona-card', { hasText: 'Socratic Tutor' }),
  ).toBeVisible();
  await expect(page.locator('.persona-card', { hasText: 'Researcher' })).toHaveCount(0);

  await page.getByLabel('Search personas').fill('');

  // Activating a persona gives it the active treatment. (It stays in Official
  // and also shows under Recently used, so scope to the Official card.)
  const researcher = officialSection.locator('.persona-card', {
    hasText: 'Researcher',
  });
  const researcherButton = researcher.getByRole('button', { name: /Researcher/ });
  await researcherButton.click();
  await expect(researcherButton).toHaveAttribute('aria-pressed', 'true');
  await expect(researcher.getByText('Active')).toBeVisible();

  // Pinning a persona moves it into the Pinned section.
  const directCard = page.locator('.persona-card', { hasText: 'Direct' });
  await directCard.getByRole('button', { name: 'Pin persona' }).click();

  const pinnedSection = page.locator('.personas-page__section', { hasText: 'Pinned' });
  await expect(pinnedSection.getByText('Direct')).toBeVisible();

  expect(pageErrors).toEqual([]);
});

test('keeps the chat sidebar and closes on Escape', async ({ page }) => {
  const userFixture = buildVaultFixture('user_e2e_shell', 'shell@example.com');
  await seedAuthenticatedUnlockState(page, userFixture);

  await page.route(`${API}/api/v1/user-key-pair`, async (route) => {
    await route.fulfill({ json: userFixture.userKeyPairRecord });
  });
  await page.route(`${API}/api/v1/vault-session`, async (route) => {
    await route.fulfill({ json: userFixture.vaultSession });
  });
  await page.route(`${API}/api/v1/billing`, async (route) => {
    await route.fulfill({ json: billingResponse });
  });
  await page.route(`${API}/api/v1/user-preferences`, async (route) => {
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Not found' }),
    });
  });
  await page.route(`${API}/api/v1/projects`, async (route) => {
    await route.fulfill({ json: [] });
  });
  await page.route(`${API}/api/v1/conversations`, async (route) => {
    await route.fulfill({ json: [] });
  });
  await page.route(`${API}/api/v1/personas`, async (route) => {
    await route.fulfill({ json: { items: [] } });
  });
  await page.route(`${API}/api/v1/models`, async (route) => {
    await route.fulfill({ json: modelsResponse });
  });

  // Start on the chat home and open personas via the "All" chip.
  await page.goto('/');
  const composer = page.getByLabel(
    'Message Cognos — stored encrypted; sent to your provider to reply',
  );
  await expect(composer).toBeVisible();

  await page.locator('.persona-chips').getByText('All').click();

  // Personas page is shown, and the chat sidebar is still present.
  await expect(
    page.getByRole('heading', { name: 'Personas', exact: true }),
  ).toBeVisible();
  await expect(page.getByLabel('Search conversations')).toBeVisible();

  // Escape returns to the conversation view.
  await page.keyboard.press('Escape');
  await expect(composer).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Personas', exact: true }),
  ).toHaveCount(0);
});
