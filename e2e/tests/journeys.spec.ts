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
  gotoLogin,
  gotoRegister,
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

async function mockCompletionEndpoints(page: Page) {
  await page.route('**/api/v1/completions', async (route) => {
    const body = route.request().postDataJSON() as { request_id?: string } | null;

    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        request_id: body?.request_id,
        assistant_message: {
          content: 'Mocked conversation title',
          agent_id: 'cognos:generate-conversation-agent',
          model_id: 'llama-3-3-infomaniak',
          created_at: new Date().toISOString(),
        },
        usage: {
          input_tokens: 1,
          output_tokens: 1,
          total_tokens: 2,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          cost_usd: 0,
          cost_chf: 0,
          cost_rappen: 0,
          used_provider_cost: false,
        },
      }),
    });
  });

  await page.route('**/api/v1/conversations/*/complete', async (route) => {
    const body = route.request().postDataJSON() as { request_id?: string } | null;

    await route.fulfill({
      contentType: 'application/json',
      body: JSON.stringify({
        request_id: body?.request_id,
        user_message_id: 'msg-user-1',
        assistant_message: {
          id: 'msg-assistant-1',
          parent_message_id: 'msg-user-1',
          content: 'Mocked assistant reply',
          agent_id: 'cognos:simple-assistant',
          model_id: 'llama-3-3-infomaniak',
          created_at: new Date().toISOString(),
        },
        usage: {
          input_tokens: 1,
          output_tokens: 1,
          total_tokens: 2,
          cache_creation_input_tokens: 0,
          cache_read_input_tokens: 0,
          cost_usd: 0,
          cost_chf: 0,
          cost_rappen: 0,
          used_provider_cost: false,
        },
      }),
    });
  });
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
  await createEncryptedBackup(page, account.password);

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

    await page.goto('/auth/logout');
    await gotoLogin(page);
    await fillLoginForm(page, account);
    await submitLogin(page);
    await expectUnlockDialog(page);
    await unlockAccount(page, account.password, accountKey);

    await mockCompletionEndpoints(page);

    await page
      .getByLabel('Message Cognos — encrypted on this device')
      .fill('Hello from the e2e user journey');
    await page.getByRole('button', { name: /^send$/i }).click();

    await expect(page.getByText('Mocked assistant reply')).toBeVisible();

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

  test('pinning a conversation and a model uses the first-party user preferences api', async ({
    page,
  }) => {
    const apiPaths = recordApiPaths(page);
    await mockCompletionEndpoints(page);

    await provisionUnlockedAccount(page);

    await page
      .getByLabel('Message Cognos — encrypted on this device')
      .fill('Pin this conversation and model');
    await page.getByRole('button', { name: /^send$/i }).click();
    await expect(page.getByText('Mocked assistant reply')).toBeVisible();

    await page.getByRole('button', { name: /open conversation menu/i }).click();
    await page.getByRole('menuitem', { name: /^pin$/i }).click();
    await expect(page.getByText(/^pinned$/i)).toBeVisible();

    await page.getByRole('button', { name: /llama 3.3/i }).click();
    await page.getByRole('button', { name: /pin model/i }).click();

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
});
