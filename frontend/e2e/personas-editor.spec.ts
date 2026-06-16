import { expect, test } from '@playwright/test';

import { buildVaultFixture, seedAuthenticatedUnlockState } from './fixtures';

const API = 'http://localhost:8090';

test('creates an encrypted custom persona through the editor', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  const userFixture = buildVaultFixture('user_e2e_editor', 'editor@example.com');
  await seedAuthenticatedUnlockState(page, userFixture);

  let createBody: { data?: string } | undefined;

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
  await page.route(`${API}/api/v1/conversations`, async (route) => {
    await route.fulfill({ json: [] });
  });
  await page.route(`${API}/api/v1/personas`, async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { items: [] } });
      return;
    }
    createBody = route.request().postDataJSON() as { data?: string };
    await route.fulfill({
      status: 201,
      json: {
        id: 'pers_editor_1',
        created: '2026-06-16 00:00:00.000Z',
        updated: '2026-06-16 00:00:00.000Z',
        collectionId: 'l9i0pyg6kx2m0t5',
        collectionName: 'personas',
        data: createBody?.data,
        user: userFixture.authState.model.id,
      },
    });
  });

  await page.goto('/personas');
  await expect(
    page.getByRole('heading', { name: 'Personas', exact: true }),
  ).toBeVisible();

  await page.getByRole('button', { name: 'New persona' }).first().click();
  await expect(page.getByRole('heading', { name: 'Create your own' })).toBeVisible();

  await page.getByLabel('Icon pencil').click();
  await page.getByLabel('Colour teal').click();
  await page.getByLabel('Name').fill('Private coach');
  await page.getByLabel('Description').fill('Sensitive description');
  await page.getByLabel('Instructions').fill('Sensitive private prompt');
  await page.getByRole('button', { name: 'Save encrypted persona' }).click();

  // The new persona is created, shown on the page (in My personas and, as it
  // was just used, Recently used), and becomes active.
  const newCard = page.locator('.persona-card', { hasText: 'Private coach' }).first();
  await expect(newCard).toBeVisible();
  await expect(newCard).toHaveAttribute('aria-pressed', 'true');

  // The POST body carries only the opaque ciphertext, never the plaintext.
  expect(createBody?.data).toBeTruthy();
  const serialized = JSON.stringify(createBody);
  expect(serialized).not.toContain('Private coach');
  expect(serialized).not.toContain('Sensitive description');
  expect(serialized).not.toContain('Sensitive private prompt');

  expect(pageErrors).toEqual([]);
});

test('official personas open read-only and can be duplicated to edit', async ({
  page,
}) => {
  const userFixture = buildVaultFixture('user_e2e_dup', 'dup@example.com');
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
  await page.route(`${API}/api/v1/conversations`, async (route) => {
    await route.fulfill({ json: [] });
  });
  await page.route(`${API}/api/v1/personas`, async (route) => {
    await route.fulfill({ json: { items: [] } });
  });

  await page.goto('/personas');

  const directCard = page.locator('.persona-card', { hasText: 'Direct' }).first();
  await directCard.getByRole('button', { name: 'View persona' }).click();

  // Read-only official editor: no Save, but a Duplicate action.
  await expect(page.getByText('official personas can’t be edited')).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Save encrypted persona' }),
  ).toHaveCount(0);

  await page.getByRole('button', { name: 'Duplicate to edit' }).click();

  // Now editable, pre-filled with a copy name.
  await expect(page.getByRole('heading', { name: 'Create your own' })).toBeVisible();
  await expect(page.getByLabel('Name')).toHaveValue('Direct copy');
  await expect(
    page.getByRole('button', { name: 'Save encrypted persona' }),
  ).toBeEnabled();
});
