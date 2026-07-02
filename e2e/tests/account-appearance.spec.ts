import { Page, expect, test } from '@playwright/test';

import { makeTestAccount } from './fixtures';
import {
  acknowledgeAccountKey,
  captureGeneratedAccountKey,
  createEncryptedBackup,
  expectAccountKeyDialogForNewUser,
  fillRegisterForm,
  gotoRegister,
  submitRegister,
} from './helpers';

// Register a fresh user and land on the account page, where the Appearance card
// lives. New users default to System, so the starting state is deterministic.
async function registerAndOpenAccount(page: Page): Promise<void> {
  const account = makeTestAccount();
  await gotoRegister(page);
  await fillRegisterForm(page, account);
  await submitRegister(page, account);
  await expectAccountKeyDialogForNewUser(page);
  await captureGeneratedAccountKey(page);
  await acknowledgeAccountKey(page);
  await createEncryptedBackup(page);
  await page.goto('/account');
}

const chip = (page: Page, name: string) =>
  page.getByRole('button', { name, exact: true });

test.describe('account appearance theme', () => {
  test('offers Light, Dark and System and defaults to System', async ({ page }) => {
    await registerAndOpenAccount(page);

    await expect(chip(page, 'System')).toBeVisible();
    await expect(chip(page, 'Light')).toBeVisible();
    await expect(chip(page, 'Dark')).toBeVisible();

    // New users follow the device — System is the pressed chip.
    await expect(chip(page, 'System')).toHaveAttribute('aria-pressed', 'true');
  });

  test('choosing Dark applies data-theme=dark and survives a reload', async ({
    page,
  }) => {
    await registerAndOpenAccount(page);

    await chip(page, 'Dark').click();

    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(chip(page, 'Dark')).toHaveAttribute('aria-pressed', 'true');

    await page.reload();

    // The pre-bootstrap flash guard + account preference both keep it dark.
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(chip(page, 'Dark')).toHaveAttribute('aria-pressed', 'true');
  });

  test('System follows the emulated device colour scheme', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await registerAndOpenAccount(page);

    await chip(page, 'System').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');

    // Flipping the OS preference moves the app live, no reload required.
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');

    // And the resolved theme is reconstructed from the device on reload too.
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
    await expect(chip(page, 'System')).toHaveAttribute('aria-pressed', 'true');
  });

  test('persists the preference to the account as plaintext', async ({ page }) => {
    await registerAndOpenAccount(page);

    const patches: { url: string; body: string }[] = [];
    page.on('request', (request) => {
      if (
        request.method() === 'PATCH' &&
        /\/api\/collections\/users\/records\//.test(request.url())
      ) {
        patches.push({ url: request.url(), body: request.postData() ?? '' });
      }
    });

    await chip(page, 'Dark').click();

    // The choice is written to the plaintext users record, carrying the
    // preference verbatim (not the resolved theme, not an encrypted blob).
    await expect.poll(() => patches.length).toBeGreaterThan(0);
    const themePatch = patches.find((p) => p.body.includes('preferred_theme'));
    expect(themePatch, 'a preferred_theme PATCH was sent').toBeTruthy();
    expect(themePatch?.body).toContain('"preferred_theme":"dark"');
  });
});
