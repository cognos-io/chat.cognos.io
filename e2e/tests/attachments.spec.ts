import { Page, expect, test } from '@playwright/test';

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

const COMPOSER_LABEL =
  'Message Cognos — stored encrypted; sent to your provider to reply';

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

// Attachments need a saved conversation, so create one with a first message.
async function startConversation(page: Page) {
  await page.getByLabel(COMPOSER_LABEL).fill('Start a chat so I can attach files');
  await page.getByRole('button', { name: /^send$/i }).click();
  await expect(page.getByText('Mocked assistant reply')).toBeVisible();
}

function setComposerFile(page: Page, name: string, mimeType: string, body: string) {
  return page.locator('input.message-form__file-input').setInputFiles({
    name,
    mimeType,
    buffer: Buffer.from(body),
  });
}

test.describe('composer attachments', () => {
  test('attach a text file, send, and see the assistant reply', async ({ page }) => {
    await provisionUnlockedAccount(page);
    await startConversation(page);

    // The paperclip appears once the conversation is saved.
    await expect(page.getByTestId('attach-button')).toBeVisible();

    await setComposerFile(page, 'notes.txt', 'text/plain', 'the quick brown fox');

    const chip = page.getByTestId('attachment-chip');
    await expect(chip).toBeVisible();
    await expect(chip).toContainText('notes.txt');

    await page.getByLabel(COMPOSER_LABEL).fill('Summarise the attached file');
    // Send is blocked until the attachment finishes processing + uploading.
    const send = page.getByRole('button', { name: /^send$/i });
    await expect(send).toBeEnabled();
    await send.click();

    // A second assistant reply confirms the turn completed with the attachment.
    await expect(page.getByText('Mocked assistant reply')).toHaveCount(2);
    // The composer selection clears after a successful send.
    await expect(page.getByTestId('attachment-chip')).toHaveCount(0);
  });

  test('an unsupported file shows a translated error and does not block the composer', async ({
    page,
  }) => {
    await provisionUnlockedAccount(page);
    await startConversation(page);

    await setComposerFile(page, 'photo.png', 'image/png', '\x89PNG\r\n\x1a\n binary');

    const chip = page.getByTestId('attachment-chip');
    await expect(chip).toBeVisible();
    await expect(chip).toContainText(/unsupported file type/i);

    // The composer is still usable: a plain text turn still sends.
    await page.getByLabel(COMPOSER_LABEL).fill('Carry on without the file');
    await page.getByRole('button', { name: /^send$/i }).click();
    await expect(page.getByText('Mocked assistant reply')).toHaveCount(2);
  });

  test('removing a selected attachment clears it before send', async ({ page }) => {
    await provisionUnlockedAccount(page);
    await startConversation(page);

    await setComposerFile(page, 'remove-me.txt', 'text/plain', 'discard this');
    await expect(page.getByTestId('attachment-chip')).toBeVisible();

    await page.getByRole('button', { name: /remove remove-me\.txt/i }).click();
    await expect(page.getByTestId('attachment-chip')).toHaveCount(0);
  });
});
