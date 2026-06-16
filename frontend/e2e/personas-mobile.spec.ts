import { expect, test } from '@playwright/test';

import { buildVaultFixture, seedAuthenticatedUnlockState } from './fixtures';

const API = 'http://localhost:8090';

test.use({ viewport: { width: 390, height: 780 } });

test('personas page is usable on a narrow mobile viewport', async ({ page }) => {
  const userFixture = buildVaultFixture('user_e2e_mobile', 'mobile@example.com');
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
  await expect(
    page.getByRole('heading', { name: 'Personas', exact: true }),
  ).toBeVisible();

  // Cards stack to a single column at this width.
  const grid = page.locator('.personas-page__grid').first();
  await expect(grid).toHaveCSS('grid-template-columns', /^\d+(\.\d+)?px$/);

  // The grid/list toggle is hidden on mobile (it has no effect there).
  await expect(page.locator('.personas-page__view-toggle')).toBeHidden();

  // The New persona button is full width under the description.
  await expect(page.getByRole('button', { name: 'New persona' }).first()).toHaveClass(
    /cog-button--full-width/,
  );

  // The editor opens as a bottom sheet pinned to the viewport bottom.
  await page.getByRole('button', { name: 'New persona' }).first().click();
  const editor = page.locator('.personas-page__editor');
  await expect(editor).toBeVisible();
  await expect(editor).toHaveCSS('position', 'fixed');

  // And the form is reachable/usable within the sheet.
  await page.getByLabel('Name').fill('Pocket coach');
  await expect(page.getByLabel('Name')).toHaveValue('Pocket coach');
});
