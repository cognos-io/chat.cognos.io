import { expect, test } from '@playwright/test';

import { makeTestAccount } from './fixtures';
import {
  fillLoginForm,
  fillRegisterForm,
  gotoLogin,
  gotoRegister,
  submitLogin,
  submitRegister,
} from './helpers';

// Small browser checks for Google OAuth UI affordances and the password-path
// regression. The full native PocketBase popup exchange is covered by
// persona-elena.spec.ts against the loopback-only E2E identity provider.

test.describe('Google OAuth UI', () => {
  test('login page shows Continue with Google', async ({ page }) => {
    await gotoLogin(page);
    await expect(
      page.getByRole('button', { name: /continue with google/i }),
    ).toBeVisible();
  });

  test('register page shows Continue with Google', async ({ page }) => {
    await gotoRegister(page);
    await expect(
      page.getByRole('button', { name: /continue with google/i }),
    ).toBeVisible();
  });

  test('password login form still works beside Google button', async ({ page }) => {
    // Control: Google affordance must not break the existing password path.
    const account = makeTestAccount();
    await gotoRegister(page);
    await fillRegisterForm(page, account);
    await submitRegister(page, account);

    // After register we land in Account Key ceremony — clear session so we can
    // assert the login UI still works with the Google button present.
    await page.context().clearCookies();
    await page.evaluate(() => localStorage.clear());
    await gotoLogin(page);
    await expect(
      page.getByRole('button', { name: /continue with google/i }),
    ).toBeVisible();
    await fillLoginForm(page, account);
    await submitLogin(page);
    // Either unlock dialog or already-unlocked home — both prove password login
    // still works. Don't assert vault ceremony details here.
    await expect(page).not.toHaveURL(/\/auth\/login/);
  });
});
