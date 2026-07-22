import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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

const claudeFixturePath = resolve(
  __dirname,
  '../../frontend/src/app/import/fixtures/claude-conversations.json',
);
const chatgptFixturePath = resolve(
  __dirname,
  '../../frontend/src/app/import/fixtures/chatgpt-conversations.json',
);

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
  // OP-034: current-shape Claude fixture (text + content blocks). Import only
  // the first conversation so the ciphertext-only assertion stays focused.
  const claudeExport = JSON.parse(readFileSync(claudeFixturePath, 'utf8')) as unknown[];
  const exportJson = JSON.stringify([claudeExport[0]]);
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

test('imports a ChatGPT export fixture and splits sibling branches (OP-034)', async ({
  page,
}) => {
  const account = makeTestAccount();
  await gotoRegister(page);
  await fillRegisterForm(page, account);
  await submitRegister(page, account);
  await expectAccountKeyDialogForNewUser(page);
  await captureGeneratedAccountKey(page);
  await copyAccountKey(page);
  await acknowledgeAccountKey(page);
  await createEncryptedBackup(page);

  await page.getByRole('link', { name: 'Bring existing Conversations' }).click();
  await page.getByRole('button', { name: 'ChatGPT' }).click();

  const chatgptExport = readFileSync(chatgptFixturePath);
  await page.getByLabel('Choose your export file').setInputFiles({
    name: 'conversations.json',
    mimeType: 'application/json',
    buffer: chatgptExport,
  });

  await expect(
    page.getByRole('heading', { name: 'Review before importing' }),
  ).toBeVisible();
  // Linear + two branch Conversations from the current-shape fixture.
  await expect(page.getByText('Synthetic planning chat')).toBeVisible();
  await expect(page.getByText('Synthetic research fork (1)')).toBeVisible();
  await expect(page.getByText('Synthetic research fork (2)')).toBeVisible();
});
