import { expect, test } from '@playwright/test';

import { buildVaultFixture, seedAuthenticatedUnlockState } from './fixtures';

const API = 'http://localhost:8090';

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
  const officialSection = page.locator('.personas-page__section', {
    hasText: 'Official',
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

  // Activating a persona gives it the active treatment.
  const researcher = page.locator('.persona-card', { hasText: 'Researcher' });
  await researcher.click();
  await expect(researcher).toHaveAttribute('aria-pressed', 'true');
  await expect(researcher.getByText('Active')).toBeVisible();

  // Pinning a persona moves it into the Pinned section.
  const directCard = page.locator('.persona-card', { hasText: 'Direct' });
  await directCard.getByRole('button', { name: 'Pin persona' }).click();

  const pinnedSection = page.locator('.personas-page__section', { hasText: 'Pinned' });
  await expect(pinnedSection.getByText('Direct')).toBeVisible();

  expect(pageErrors).toEqual([]);
});
