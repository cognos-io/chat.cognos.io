import { expect, test } from '@playwright/test';

// Password reset and email change are enabled under account_key_v2 (the password
// and email are authentication-only, never key inputs). These pages used to be
// dead "unavailable" placeholders; guard that they are real flows now. The
// confirmation steps need an emailed token, so here we assert the request forms
// render and that token-less confirm links fail gracefully.

test.describe('account recovery surfaces', () => {
  test('forgot-password shows a working request form, not a dead end', async ({
    page,
  }) => {
    await page.goto('/auth/forgot-password');

    await expect(
      page.getByRole('heading', { name: /reset your password/i }),
    ).toBeVisible();
    await expect(page.getByText(/unavailable/i)).toHaveCount(0);
    await expect(page.getByLabel('Email')).toBeVisible();
    await expect(page.getByRole('button', { name: /send reset link/i })).toBeVisible();
  });

  test('reset-password without a token explains the broken link', async ({ page }) => {
    await page.goto('/auth/reset-password');

    await expect(page.getByText(/missing its token/i)).toBeVisible();
    await expect(page.getByRole('link', { name: /request a new link/i })).toBeVisible();
  });

  test('confirm-email-change without a token explains the broken link', async ({
    page,
  }) => {
    await page.goto('/auth/confirm-email-change');

    await expect(page.getByText(/missing its token/i)).toBeVisible();
    await expect(page.getByRole('link', { name: /go to log in/i })).toBeVisible();
  });

  test('confirm-email-change with a token asks for the password', async ({ page }) => {
    await page.goto('/auth/confirm-email-change?token=dummy-token');

    await expect(
      page.getByRole('heading', { name: /confirm your new email/i }),
    ).toBeVisible();
    await expect(page.getByLabel('Password')).toBeVisible();
    await expect(
      page.getByRole('button', { name: /confirm email change/i }),
    ).toBeVisible();
  });
});
