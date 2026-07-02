import { expect, test } from '@playwright/test';

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

// The account page lets a signed-in user change their email and password.
// Email change goes through PocketBase's verified request → confirm flow (which
// needs email delivery), so here we exercise only the request-side UI and its
// validation — the SMTP-dependent confirmation is covered by backend tests.
test.describe('account credentials surface', () => {
  test('email card validates the new address before enabling the request', async ({
    page,
  }) => {
    const account = makeTestAccount();

    await gotoRegister(page);
    await fillRegisterForm(page, account);
    await submitRegister(page, account);
    await expectAccountKeyDialogForNewUser(page);
    await captureGeneratedAccountKey(page);
    await acknowledgeAccountKey(page);
    await createEncryptedBackup(page);

    await page.goto('/account');

    // Current email is shown read-only; the dead "contact support" copy is gone.
    await expect(page.getByLabel('Current email')).toHaveValue(account.email);
    await expect(page.getByText(/aren.t available yet/i)).toHaveCount(0);

    const newEmail = page.getByLabel('New email');
    const submit = page.getByRole('button', { name: /send confirmation link/i });

    // Empty, unchanged, and malformed addresses all keep the button disabled.
    await expect(submit).toBeDisabled();
    await newEmail.fill(account.email);
    await expect(submit).toBeDisabled();
    await newEmail.fill('not-an-email');
    await expect(submit).toBeDisabled();

    // A valid, different address enables the request.
    await newEmail.fill(`changed-${account.email}`);
    await expect(submit).toBeEnabled();
  });

  test('password card is present for signed-in users', async ({ page }) => {
    const account = makeTestAccount();

    await gotoRegister(page);
    await fillRegisterForm(page, account);
    await submitRegister(page, account);
    await expectAccountKeyDialogForNewUser(page);
    await captureGeneratedAccountKey(page);
    await acknowledgeAccountKey(page);
    await createEncryptedBackup(page);

    await page.goto('/account');

    await expect(page.getByLabel('Current password')).toBeVisible();
    await expect(page.getByLabel('New password')).toBeVisible();
    await expect(page.getByRole('button', { name: /change password/i })).toBeVisible();
  });
});
