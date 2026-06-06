import { expect, test } from '@playwright/test';

import { makeTestAccount } from './fixtures';
import {
  acknowledgeAccountKey,
  captureGeneratedAccountKey,
  copyAccountKey,
  createEncryptedBackup,
  expectAccountKeyDialogForNewUser,
  expectLockedDialog,
  expectUnlockDialog,
  fillLoginForm,
  fillRegisterForm,
  gotoLogin,
  gotoRegister,
  lockFromDrawer,
  logout,
  openMobileDrawer,
  submitLogin,
  submitRegister,
  unlockAccount,
} from './helpers';

test.describe('auth + account key flow', () => {
  test('login page links to register and forgot-password', async ({ page }) => {
    await gotoLogin(page);

    const registerLink = page.getByRole('link', { name: /register/i });
    await expect(registerLink).toBeVisible();
    await registerLink.click();
    await expect(page).toHaveURL(/\/auth\/register/);

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

  test('register → copy Account Key → acknowledge → logout → login → unlock', async ({
    page,
  }) => {
    const account = makeTestAccount();

    await gotoRegister(page);
    await fillRegisterForm(page, account);
    await submitRegister(page);

    await expectAccountKeyDialogForNewUser(page);

    const accountKey = await captureGeneratedAccountKey(page);
    await copyAccountKey(page);
    await acknowledgeAccountKey(page);
    await createEncryptedBackup(page, account.password);

    await logout(page);

    await gotoLogin(page);
    await fillLoginForm(page, account);
    await submitLogin(page);

    await expectUnlockDialog(page);
    await unlockAccount(page, account.password, accountKey);
  });

  test('lock shows a toast and requires unlock again without logging out', async ({
    page,
  }) => {
    const account = makeTestAccount();

    await gotoRegister(page);
    await fillRegisterForm(page, account);
    await submitRegister(page);

    await expectAccountKeyDialogForNewUser(page);

    const accountKey = await captureGeneratedAccountKey(page);
    await copyAccountKey(page);
    await acknowledgeAccountKey(page);
    await createEncryptedBackup(page, account.password);

    await openMobileDrawer(page);
    await lockFromDrawer(page);
    await expectLockedDialog(page);
    await expect(page).toHaveURL(/\/$/);

    await unlockAccount(page, account.password, accountKey);
  });

  test('wrong login password shows an error', async ({ page }) => {
    await gotoLogin(page);
    await page.getByLabel('Email').fill('nobody@cognos-e2e.test');
    await page.getByLabel('Password').fill('not-the-right-password');
    await submitLogin(page);

    await expect(page.getByText(/couldn't sign you in/i)).toBeVisible();
  });
});
