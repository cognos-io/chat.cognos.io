import { expect, test } from '@playwright/test';

import { buildVaultFixture, seedAuthenticatedUnlockState } from './fixtures';

const API = 'http://localhost:8090';

// Recency is additive: using a persona surfaces it under "Recently used" but it
// must NOT disappear from its home section. A custom persona therefore shows in
// both "Recently used" and "My personas".
test('a used custom persona appears in both Recently used and My personas', async ({
  page,
}) => {
  const userFixture = buildVaultFixture('user_e2e_recents', 'recents@example.com');
  await seedAuthenticatedUnlockState(page, userFixture);

  await page.route(`${API}/api/v1/user-key-pair`, async (route) => {
    await route.fulfill({ json: userFixture.userKeyPairRecord });
  });
  await page.route(`${API}/api/v1/vault-session`, async (route) => {
    await route.fulfill({ json: userFixture.vaultSession });
  });
  await page.route(`${API}/api/v1/conversations`, async (route) => {
    await route.fulfill({ json: [] });
  });

  await page.route(`${API}/api/v1/user-preferences`, async (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as { data: string };
      await route.fulfill({ status: 201, json: { id: 'prefs_rec', data: body.data } });
      return;
    }
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Not found' }),
    });
  });
  await page.route(`${API}/api/v1/user-preferences/prefs_rec`, async (route) => {
    const body = route.request().postDataJSON() as { data: string };
    await route.fulfill({ json: { id: 'prefs_rec', data: body.data } });
  });

  await page.route(`${API}/api/v1/personas`, async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { items: [] } });
      return;
    }
    const body = route.request().postDataJSON() as { data?: string };
    await route.fulfill({
      status: 201,
      json: {
        id: 'pers_pirate',
        created: '2026-06-16 00:00:00.000Z',
        updated: '2026-06-16 00:00:00.000Z',
        collectionId: 'l9i0pyg6kx2m0t5',
        collectionName: 'personas',
        data: body?.data,
        user: userFixture.authState.model.id,
      },
    });
  });

  await page.goto('/personas');
  await expect(
    page.getByRole('heading', { name: 'Personas', exact: true }),
  ).toBeVisible();

  // Create (and thereby select / use) a custom persona.
  await page.getByRole('button', { name: 'New persona' }).first().click();
  await page.getByLabel('Name').fill('Pirate');
  await page.getByLabel('Description').fill('Talk like a pirate.');
  await page.getByLabel('Instructions').fill('Respond in pirate dialect, matey.');
  await page.getByRole('button', { name: 'Save encrypted persona' }).click();

  // It is now recently used AND still a custom persona — it must show in both.
  const recentSection = page.locator('.personas-page__section', {
    hasText: 'Recently used',
  });
  const mySection = page.locator('.personas-page__section', { hasText: 'My personas' });

  await expect(
    recentSection.locator('.persona-card', { hasText: 'Pirate' }),
  ).toBeVisible();
  await expect(mySection.locator('.persona-card', { hasText: 'Pirate' })).toBeVisible();
});
