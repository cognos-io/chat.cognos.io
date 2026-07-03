import { Page, expect, test } from '@playwright/test';

import { makeTestAccount } from './fixtures';
import {
  acknowledgeAccountKey,
  captureGeneratedAccountKey,
  copyAccountKey,
  createEncryptedBackup,
  expectAccountKeyDialogForNewUser,
  expectUnlockDialog,
  fillLoginForm,
  fillRegisterForm,
  gotoRegister,
  logout,
  submitLogin,
  submitRegister,
  unlockAccount,
} from './helpers';

// The e2e (and development) environment must never emit analytics events:
// `environment.analytics.enabled` is explicitly false, and the app never loads
// vendor analytics JavaScript (docs/specs/product-analytics.md §1/§3.4/§10).
// This walks a full login → send-message → logout journey while recording
// every network request the page makes and asserts none of them touch
// Plausible. It would also catch an accidentally added vendor script tag.

function recordAnalyticsRequests(page: Page): string[] {
  const offending: string[] = [];
  page.on('request', (request) => {
    if (request.url().includes('plausible.io')) {
      offending.push(request.url());
    }
  });
  return offending;
}

function recordApiPaths(page: Page): string[] {
  const paths: string[] = [];
  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/')) {
      paths.push(url.pathname);
    }
  });
  return paths;
}

test.describe('product analytics privacy guarantees', () => {
  test('a full login → send-message → logout journey emits zero requests to plausible.io', async ({
    page,
  }) => {
    const analyticsRequests = recordAnalyticsRequests(page);
    const apiPaths = recordApiPaths(page);
    const account = makeTestAccount();

    // Register a fresh account and create the encrypted backup so the journey
    // covers signup, onboarding, and vault instrumentation call sites too.
    await gotoRegister(page);
    await fillRegisterForm(page, account);
    await submitRegister(page, account);
    await expectAccountKeyDialogForNewUser(page);
    const accountKey = await captureGeneratedAccountKey(page);
    await copyAccountKey(page);
    await acknowledgeAccountKey(page);
    await createEncryptedBackup(page);

    // Log out and back in — the instrumented login + vault-unlock paths run.
    await logout(page);
    await fillLoginForm(page, account);
    await submitLogin(page);
    await expectUnlockDialog(page);
    await unlockAccount(page, accountKey);

    // Send a message and wait for the completion round-trip, exercising the
    // conversation_created / message_sent call sites.
    await page
      .getByLabel('Message Cognos — stored encrypted; sent to your provider to reply')
      .fill('Hello from the analytics privacy journey');
    await page.getByRole('button', { name: /^send$/i }).click();
    await expect
      .poll(() =>
        apiPaths.some((path) =>
          /\/api\/v1\/conversations\/[^/]+\/complete$/.test(path),
        ),
      )
      .toBe(true);

    await logout(page);

    expect(analyticsRequests).toEqual([]);
  });
});
