import { Page, expect, test } from '@playwright/test';

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
  gotoRegister,
  logout,
  submitLogin,
  submitRegister,
  unlockAccount,
} from './helpers';

function recordApiPaths(page: Page) {
  const paths: string[] = [];

  page.on('request', (request) => {
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/')) {
      paths.push(url.pathname);
    }
  });

  return paths;
}

async function provisionUnlockedAccount(page: Page) {
  const account = makeTestAccount();

  await gotoRegister(page);
  await fillRegisterForm(page, account);
  await submitRegister(page);

  await expectAccountKeyDialogForNewUser(page);

  const accountKey = await captureGeneratedAccountKey(page);
  await copyAccountKey(page);
  await acknowledgeAccountKey(page);
  await createEncryptedBackup(page);

  return { account, accountKey };
}

test.describe('high-level user journeys', () => {
  test('registering and creating a backup uses the first-party user key pair api', async ({
    page,
  }) => {
    const apiPaths = recordApiPaths(page);

    await provisionUnlockedAccount(page);

    await expect
      .poll(() => apiPaths.some((path) => path === '/api/v1/user-key-pair'))
      .toBe(true);

    expect(apiPaths).not.toContain('/api/collections/user_key_pairs/records');
  });

  test('unlocking and sending a first message creates conversation key records through first-party apis', async ({
    page,
  }) => {
    const apiPaths = recordApiPaths(page);
    const { account, accountKey } = await provisionUnlockedAccount(page);

    await logout(page);
    await fillLoginForm(page, account);
    await submitLogin(page);
    await expectUnlockDialog(page);
    await unlockAccount(page, accountKey);

    await page
      .getByLabel('Message Cognos — stored encrypted; sent to your provider to reply')
      .fill('Hello from the e2e user journey');
    await page.getByRole('button', { name: /^send$/i }).click();

    await expect
      .poll(() => apiPaths.some((path) => path === '/api/v1/conversations'))
      .toBe(true);
    await expect
      .poll(() =>
        apiPaths.some((path) =>
          /\/api\/v1\/conversations\/[^/]+\/public-key$/.test(path),
        ),
      )
      .toBe(true);
    await expect
      .poll(() =>
        apiPaths.some((path) =>
          /\/api\/v1\/conversations\/[^/]+\/secret-key$/.test(path),
        ),
      )
      .toBe(true);
    await expect
      .poll(() => apiPaths.some((path) => path === '/api/v1/completions'))
      .toBe(true);
    await expect
      .poll(() =>
        apiPaths.some((path) =>
          /\/api\/v1\/conversations\/[^/]+\/complete$/.test(path),
        ),
      )
      .toBe(true);

    expect(
      apiPaths.some((path) =>
        path.includes('/api/collections/conversation_public_keys'),
      ),
    ).toBe(false);
    expect(
      apiPaths.some((path) =>
        path.includes('/api/collections/conversation_secret_keys'),
      ),
    ).toBe(false);
  });

  test('pinning and unpinning a conversation uses the first-party user preferences api', async ({
    page,
  }) => {
    const apiPaths = recordApiPaths(page);

    await provisionUnlockedAccount(page);

    await page
      .getByLabel('Message Cognos — stored encrypted; sent to your provider to reply')
      .fill('Pin this conversation and model');
    await page.getByRole('button', { name: /^send$/i }).click();
    await expect
      .poll(() => apiPaths.some((path) => path === '/api/v1/conversations'))
      .toBe(true);

    await page.getByRole('button', { name: /open conversation menu/i }).click();
    await page.getByRole('menuitem', { name: /^pin$/i }).click();
    await expect(page.getByText(/^pinned$/i)).toBeVisible();

    await page.getByRole('button', { name: /open conversation menu/i }).click();
    await page.getByRole('menuitem', { name: /^unpin$/i }).click();

    await expect
      .poll(() => apiPaths.some((path) => path === '/api/v1/user-preferences'))
      .toBe(true);
    await expect
      .poll(() =>
        apiPaths.some((path) => /\/api\/v1\/user-preferences\/[^/]+$/.test(path)),
      )
      .toBe(true);

    expect(
      apiPaths.some((path) => path.includes('/api/collections/user_preferences')),
    ).toBe(false);
  });

  test('lock then unlock fetches and decrypts persisted messages', async ({ page }) => {
    const apiPaths = recordApiPaths(page);

    const { accountKey } = await provisionUnlockedAccount(page);

    await page
      .getByLabel('Message Cognos — stored encrypted; sent to your provider to reply')
      .fill('Message that should survive lock and unlock');
    await page.getByRole('button', { name: /^send$/i }).click();

    await expect
      .poll(() =>
        apiPaths.some((path) =>
          /\/api\/v1\/conversations\/[^/]+\/complete$/.test(path),
        ),
      )
      .toBe(true);
    // Under SSE streaming the assistant reply arrives over the /complete stream
    // and renders directly — there is no separate /messages fetch on send. Wait
    // for the rendered reply to confirm the turn completed and persisted.
    await expect(page.getByText('Mocked assistant reply')).toBeVisible();

    const conversationUrl = page.url();

    await page.locator('app-chat').waitFor();
    // Lock via the sidebar account actions (the "Lock" button → VaultService.lock()).
    await page.getByRole('button', { name: /^lock$/i }).click();
    await expectLockedDialog(page);

    // v2 unlock asks for the Account Key alone — there is no password field.
    const accountKeyField = page.getByLabel('Account Key');
    await accountKeyField.click();
    await accountKeyField.fill(accountKey);
    await page.getByRole('button', { name: /unlock encrypted backup/i }).click();
    await expect(page.getByRole('heading', { name: /unlock backup/i })).toBeHidden();
    await expect(page.getByRole('heading', { name: /account locked/i })).toBeHidden();

    await page.getByRole('button', { name: /new chat/i }).click();
    await page.getByRole('link', { name: 'Mocked conversation title' }).click();
    await expect(page).toHaveURL(conversationUrl);

    await expect(page.locator('li[data-owner-id]')).toHaveCount(1);

    await expect
      .poll(() =>
        apiPaths.some((path) =>
          /\/api\/v1\/conversations\/[^/]+\/messages$/.test(path),
        ),
      )
      .toBe(true);
    await expect
      .poll(() =>
        apiPaths.some((path) =>
          /\/api\/v1\/conversations\/[^/]+\/public-key$/.test(path),
        ),
      )
      .toBe(true);
    await expect
      .poll(() =>
        apiPaths.some((path) =>
          /\/api\/v1\/conversations\/[^/]+\/secret-key$/.test(path),
        ),
      )
      .toBe(true);
  });
});
