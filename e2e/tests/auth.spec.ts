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

  test('reloading the page after unlock keeps the vault unlocked', async ({ page }) => {
    const account = makeTestAccount();

    await gotoRegister(page);
    await fillRegisterForm(page, account);
    await submitRegister(page);

    await expectAccountKeyDialogForNewUser(page);

    const accountKey = await captureGeneratedAccountKey(page);
    await copyAccountKey(page);
    await acknowledgeAccountKey(page);
    await createEncryptedBackup(page, account.password);

    await expect(
      page.getByLabel('Message Cognos — encrypted on this device'),
    ).toBeVisible();

    await page.reload();

    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByRole('heading', { name: /unlock backup/i })).toBeHidden();
    await expect(page.getByRole('heading', { name: /account locked/i })).toBeHidden();
    await expect(
      page.getByRole('heading', { name: /secure your encrypted backup/i }),
    ).toBeHidden();
    await expect(
      page.getByLabel('Message Cognos — encrypted on this device'),
    ).toBeVisible();

    // Also covers reopening the app in a new tab from the same origin.
    const newPage = await page.context().newPage();
    await newPage.goto('/');
    await expect(newPage).toHaveURL(/\/$/);
    await expect(newPage.getByRole('heading', { name: /unlock backup/i })).toBeHidden();
    await expect(
      newPage.getByLabel('Message Cognos — encrypted on this device'),
    ).toBeVisible();
    await newPage.close();
  });

  test('reloading the page after unlock never flashes the unlock dialog', async ({
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
    await expect(
      page.getByLabel('Message Cognos — encrypted on this device'),
    ).toBeVisible();

    // Install a MutationObserver that runs from the very first script execution
    // after navigation. It records every time anything from the unlock dialog
    // appears in the DOM, so a brief flash that the post-load `toBeHidden`
    // assertion would miss is still detectable. It also records the loading
    // overlay so we can positively assert it was shown during the restore.
    await page.addInitScript(() => {
      const w = window as unknown as {
        __unlockDialogAppearances: string[];
        __restoreOverlaySeen: boolean;
      };
      w.__unlockDialogAppearances = [];
      w.__restoreOverlaySeen = false;

      const inspect = () => {
        if (
          document.querySelector('app-vault-password-dialog, .vault-password-dialog')
        ) {
          w.__unlockDialogAppearances.push('vault-password-dialog');
        }
        if (document.querySelector('.chat-shell__vault-restore')) {
          w.__restoreOverlaySeen = true;
        }
      };
      inspect();

      const observer = new MutationObserver(inspect);
      if (document.documentElement) {
        observer.observe(document.documentElement, {
          childList: true,
          subtree: true,
        });
      } else {
        document.addEventListener(
          'readystatechange',
          () => {
            observer.observe(document.documentElement, {
              childList: true,
              subtree: true,
            });
          },
          { once: true },
        );
      }
    });

    // Simulate a slow network on the vault-session endpoint so any race between
    // `isRestoring` flipping false and `keyPair` becoming available has a wide
    // enough window to be observable in the DOM. Same for user-key-pair so the
    // pre-fetch period is also extended.
    await page.route('**/api/v1/vault-session', async (route) => {
      await new Promise((r) => setTimeout(r, 600));
      await route.continue();
    });
    await page.route('**/api/v1/user-key-pair', async (route) => {
      await new Promise((r) => setTimeout(r, 600));
      await route.continue();
    });

    await page.reload();

    await expect(
      page.getByLabel('Message Cognos — encrypted on this device'),
    ).toBeVisible();

    const { appearances, overlaySeen } = await page.evaluate(() => {
      const w = window as unknown as {
        __unlockDialogAppearances: string[];
        __restoreOverlaySeen: boolean;
      };
      return {
        appearances: w.__unlockDialogAppearances ?? [],
        overlaySeen: w.__restoreOverlaySeen ?? false,
      };
    });
    expect(appearances).toEqual([]);
    expect(overlaySeen).toBe(true);
  });

  test('wrong login password shows an error', async ({ page }) => {
    await gotoLogin(page);
    await page.getByLabel('Email').fill('nobody@cognos-e2e.test');
    await page.getByLabel('Password').fill('not-the-right-password');
    await submitLogin(page);

    await expect(page.getByText(/couldn't sign you in/i)).toBeVisible();
  });
});
