import { Page, expect, test } from '@playwright/test';
import { randomBytes } from 'node:crypto';

import {
  acknowledgeAccountKey,
  captureGeneratedAccountKey,
  copyAccountKey,
  createEncryptedBackup,
  expectAccountKeyDialogForNewUser,
  expectUnlockDialog,
  gotoLogin,
  gotoRegister,
  logout,
  unlockAccount,
} from './helpers';
import { expectNoRawI18nKeys, makeShooter } from './persona-helpers';

// PERSONA WALKTHROUGH — Elena Rossi (PER-007), Google-first Account holder.
// Elena expects one-click sign-in on Safari, but must still understand that
// Google proves her identity while the Account Key unlocks encrypted data.
// This spec drives PocketBase's native OAuth exchange against the loopback-only
// E2E identity provider; no production bypass or real Google credential is used.

const AI_MOCK_URL = process.env.E2E_AI_MOCK_URL ?? 'http://127.0.0.1:18085';

async function continueWithGoogle(page: Page): Promise<void> {
  const popupPromise = page.waitForEvent('popup');
  await page.getByRole('button', { name: /continue with google/i }).click();
  const popup = await popupPromise;
  if (!popup.isClosed()) {
    await popup.waitForEvent('close');
  }
}

test.describe('persona walkthrough: Elena — Google-first Account holder', () => {
  test('Google signup → Account Key → OAuth-only settings → returning sign-in', async ({
    page,
    context,
  }) => {
    test.setTimeout(180_000);
    const shot = makeShooter(page, 'elena');
    const profile = `elena-${randomBytes(6).toString('hex')}`;

    await context.addCookies([
      {
        name: 'cognos_e2e_google_profile',
        value: profile,
        url: AI_MOCK_URL,
        sameSite: 'Lax',
      },
    ]);

    await test.step('Continue with Google creates the Account', async () => {
      await gotoRegister(page);
      await expect(
        page.getByRole('button', { name: /continue with google/i }),
      ).toBeVisible();
      await shot('continue-with-google');

      await continueWithGoogle(page);
      await expectAccountKeyDialogForNewUser(page);
      await expectNoRawI18nKeys(page, 'Google Account Key ceremony');

      // The generated Account Key is visible in this one-time ceremony. Mask
      // it before capturing a durable artefact, then restore it so the test can
      // continue with the real key.
      const accountKeyValue = page.locator('.vault-password-dialog__account-key-value');
      const generatedAccountKey = (await accountKeyValue.textContent())?.trim() ?? '';
      await accountKeyValue.evaluate((element) => {
        element.textContent = '•••• •••• •••• ••••';
      });
      await shot('account-key-is-separate');
      await accountKeyValue.evaluate((element, accountKey) => {
        element.textContent = accountKey;
      }, generatedAccountKey);
    });

    let accountKey = '';
    await test.step('save Account Key and create encrypted backup', async () => {
      accountKey = await captureGeneratedAccountKey(page);
      await copyAccountKey(page);
      await acknowledgeAccountKey(page);
      await createEncryptedBackup(page);
      await expect(page).toHaveURL(/\/$/);
    });

    await test.step('OAuth-only security settings explain the limits', async () => {
      await page.goto('/account/security');
      await expect(
        page.getByText(/Google is connected to your account/i),
      ).toBeVisible();
      await expect(page.getByText(/You sign in with Google/i)).toBeVisible();
      await expect(
        page.getByText(/does(?: not|n't) have a Cognos password/i),
      ).toBeVisible();
      await expectNoRawI18nKeys(page, 'OAuth-only security settings');
      await shot('google-only-security');

      await page.goto('/account');
      await expect(page.getByText(/sign in with Google.*email address/i)).toBeVisible();
      await expect(page.getByLabel(/new email/i)).toHaveCount(0);
    });

    await test.step('returning Google sign-in still needs Account Key to Unlock', async () => {
      await logout(page);
      await gotoLogin(page);
      await continueWithGoogle(page);

      await expectUnlockDialog(page);
      await shot('google-signed-in-vault-locked');
      await unlockAccount(page, accountKey);
      await expect(page).toHaveURL(/\/$/);
    });
  });
});
