import { expect, test } from '@playwright/test';

import { makeTestAccount } from './fixtures';
import {
  createVault,
  expectVaultDialogForExistingUser,
  expectVaultDialogForNewUser,
  fillLoginForm,
  fillRegisterForm,
  gotoLogin,
  gotoRegister,
  logout,
  submitLogin,
  submitRegister,
  unlockVault,
} from './helpers';

test.describe('auth + vault flow', () => {
  test('login page links to register and forgot-password', async ({ page }) => {
    await gotoLogin(page);

    const registerLink = page.getByRole('link', { name: /register/i });
    await expect(registerLink).toBeVisible();
    await registerLink.click();
    await expect(page).toHaveURL(/\/auth\/register/);

    // And back again
    await page.getByRole('link', { name: /log in/i }).click();
    await expect(page).toHaveURL(/\/auth\/login/);

    await expect(
      page.getByRole('link', { name: /forgot your password\?/i }),
    ).toBeVisible();
  });

  test('register form rejects mismatched passwords', async ({ page }) => {
    await gotoRegister(page);

    await page.getByLabel('Email').fill('mismatch@cognos-e2e.test');
    await page.getByLabel('Password', { exact: true }).fill('password-one');
    await page.getByLabel('Confirm password').fill('password-two');
    await page.getByLabel('Confirm password').blur();

    await expect(page.getByText(/passwords don't match/i)).toBeVisible();
    await expect(page.getByRole('button', { name: /create account/i })).toBeDisabled();
  });

  test('register → set vault password → logout → login → unlock vault', async ({
    page,
  }) => {
    const account = makeTestAccount();

    // 1. Register
    await gotoRegister(page);
    await fillRegisterForm(page, account);
    await submitRegister(page);

    // 2. New-user vault creation dialog appears (route transition is held
    //    open by the keypair-required guard until we submit).
    await expectVaultDialogForNewUser(page);
    await createVault(page, account.vaultPassword);

    // 3. Logout
    await logout(page);

    // 4. Login again
    await gotoLogin(page);
    await fillLoginForm(page, account);
    await submitLogin(page);

    // 5. Existing-user unlock dialog
    await expectVaultDialogForExistingUser(page);
    await unlockVault(page, account.vaultPassword);
  });

  test('wrong login password shows an error', async ({ page }) => {
    await gotoLogin(page);
    await page.getByLabel('Email').fill('nobody@cognos-e2e.test');
    await page.getByLabel('Password').fill('not-the-right-password');
    await submitLogin(page);

    // The login page renders an inline hint when the auth status is 'error'.
    await expect(page.getByText(/couldn't sign you in/i)).toBeVisible();
  });
});
