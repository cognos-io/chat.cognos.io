import { expect, test } from '@playwright/test';

import { makeTestAccount } from './fixtures';
import {
  acknowledgeAccountKey,
  captureGeneratedAccountKey,
  copyAccountKey,
  createEncryptedBackup,
  expectAccountKeyDialogForNewUser,
  fillRegisterForm,
  gotoRegister,
  submitRegister,
} from './helpers';
import { pinWorkerHasNoNetworkConsoleOrPersistence } from './import-worker-pins';

test('import worker has no network, console or persistence capability', async () => {
  await pinWorkerHasNoNetworkConsoleOrPersistence();
});

test('imports a Claude export locally and sends only ciphertext to Cognos', async ({
  page,
}) => {
  const account = makeTestAccount();
  const requestBodies: string[] = [];
  const apiPaths: string[] = [];
  page.on('request', (request) => {
    const body = request.postData();
    if (body) requestBodies.push(body);
    const url = new URL(request.url());
    if (url.pathname.startsWith('/api/')) apiPaths.push(url.pathname);
  });

  await gotoRegister(page);
  await fillRegisterForm(page, account);
  await submitRegister(page, account);
  await expectAccountKeyDialogForNewUser(page);
  await captureGeneratedAccountKey(page);
  await copyAccountKey(page);
  await acknowledgeAccountKey(page);
  await createEncryptedBackup(page);

  await page.getByRole('link', { name: 'Bring existing Conversations' }).click();
  await expect(
    page.getByRole('heading', { name: 'Bring your Conversations to Cognos' }),
  ).toBeVisible();
  await page.getByRole('button', { name: 'Claude' }).click();
  await expect(page.getByRole('heading', { name: 'Export from Claude' })).toBeVisible();

  const privateMarker = 'SYNTHETIC-LOCAL-IMPORT-MARKER-b1946ac9';
  const exportJson = JSON.stringify([
    {
      uuid: 'synthetic-conversation',
      name: 'Synthetic private planning',
      created_at: '2026-01-02T10:00:00Z',
      chat_messages: [
        {
          uuid: 'synthetic-user-message',
          sender: 'human',
          text: privateMarker,
          created_at: '2026-01-02T10:00:00Z',
        },
        {
          uuid: 'synthetic-assistant-message',
          sender: 'assistant',
          text: 'Synthetic imported answer',
          created_at: '2026-01-02T10:00:01Z',
        },
      ],
    },
  ]);
  await page.getByLabel('Choose your export file').setInputFiles({
    name: 'claude-export.json',
    mimeType: 'application/json',
    buffer: Buffer.from(exportJson),
  });

  await expect(page.getByText('Synthetic private planning')).toBeVisible();
  expect(requestBodies.join('\n')).not.toContain(privateMarker);

  await page.getByRole('button', { name: 'Encrypt and import 1' }).click();

  await expect(page).toHaveURL(/\/c\/[^/]+$/);
  await expect(page.getByText(privateMarker)).toBeVisible();
  await expect(page.getByText('Synthetic imported answer')).toBeVisible();
  expect(requestBodies.join('\n')).not.toContain(privateMarker);
  expect(apiPaths).toContain('/api/v1/conversation-imports');
  expect(apiPaths.some((path) => path.includes('/complete'))).toBe(false);
});
