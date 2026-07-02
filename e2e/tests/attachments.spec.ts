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
  await submitRegister(page, account);
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
  test('attach a text file on a fresh chat, send, and see the assistant reply', async ({
    page,
  }) => {
    await provisionUnlockedAccount(page);

    // The paperclip is available on a brand-new chat; attaching creates the
    // conversation (no need to send a message first).
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

    // The assistant reply confirms the turn completed with the attachment.
    await expect(page.getByText('Mocked assistant reply')).toBeVisible();
    // The composer selection clears after a successful send.
    await expect(page.getByTestId('attachment-chip')).toHaveCount(0);
  });

  test('an unsupported file shows a translated error and does not block the composer', async ({
    page,
  }) => {
    await provisionUnlockedAccount(page);
    await startConversation(page);

    await setComposerFile(page, 'clip.mp4', 'video/mp4', 'not really a video');

    const chip = page.getByTestId('attachment-chip');
    await expect(chip).toBeVisible();
    await expect(chip).toContainText(/unsupported file type/i);

    // The composer is still usable: a plain text turn still sends.
    await page.getByLabel(COMPOSER_LABEL).fill('Carry on without the file');
    await page.getByRole('button', { name: /^send$/i }).click();
    await expect(page.getByText('Mocked assistant reply')).toHaveCount(2);
  });

  test('attaching an image to a non-vision model shows a clear notice and no chip', async ({
    page,
  }) => {
    await provisionUnlockedAccount(page);
    await startConversation(page);

    // The e2e catalogue has no vision-capable model, so an image is rejected at
    // selection with the imageNeedsVision notice (no chip is created).
    await setComposerFile(page, 'cat.png', 'image/png', '\x89PNG\r\n\x1a\n binary');

    await expect(page.getByText(/read images/i)).toBeVisible();
    await expect(page.getByTestId('attachment-chip')).toHaveCount(0);
  });

  test('redacts sensitive values extracted from an attachment before they reach the provider', async ({
    page,
  }) => {
    await provisionUnlockedAccount(page);
    await startConversation(page);

    // Capture what the client sends to the completion endpoint without breaking
    // the real backend flow (continue the request through).
    let sentContexts: Array<{ text_context?: string }> | undefined;
    let sentSystemPrompt = '';
    await page.route('**/complete', async (route) => {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON() as {
          attachment_contexts?: Array<{ text_context?: string }>;
          system_prompt?: string;
        };
        sentContexts = body.attachment_contexts;
        sentSystemPrompt = body.system_prompt ?? '';
      }
      await route.continue();
    });

    const iban = 'DE75512108001245126199';
    const email = 'cognos@example.com';
    await setComposerFile(
      page,
      'sensitive.md',
      'text/markdown',
      `# Personal Information\n\nmy name is ${email}.\n\nMy IBAN is ${iban}\n`,
    );

    await expect(page.getByTestId('attachment-chip')).toContainText('sensitive.md');

    await page.getByLabel(COMPOSER_LABEL).fill('Summarise the attached file');
    const send = page.getByRole('button', { name: /^send$/i });
    await expect(send).toBeEnabled();
    await send.click();

    await expect(page.getByText('Mocked assistant reply')).toBeVisible();

    // The extracted text reached the provider as placeholders, never raw values.
    const text = sentContexts?.[0]?.text_context ?? '';
    expect(text).not.toContain(iban);
    expect(text).not.toContain(email);
    expect(text).toMatch(/\[\[PII_IBAN_[A-Z0-9]+\]\]/);
    expect(text).toMatch(/\[\[PII_EMAIL_[A-Z0-9]+\]\]/);

    // The body carried no PII, so the only redaction came from the attachment —
    // the system prompt must still tell the model to preserve the placeholders.
    expect(sentSystemPrompt).toContain('placeholders');
  });

  test('hydrates attachment redaction tokens and survives a reload', async ({
    page,
  }) => {
    await provisionUnlockedAccount(page);
    // Attach to a brand-new chat (no prior turn) — attaching creates the
    // conversation, mirroring the reported scenario where the attachment message
    // is the first message in the thread.
    await expect(page.getByTestId('attach-button')).toBeVisible();

    const iban = 'DE75512108001245126199';
    const email = 'cognos@example.com';
    await setComposerFile(
      page,
      'sensitive.md',
      'text/markdown',
      `# Personal Information\n\nmy name is ${email}.\n\nMy IBAN is ${iban}\n`,
    );
    await expect(page.getByTestId('attachment-chip')).toContainText('sensitive.md');

    // `[echo]` makes the mock reply with the assembled user turn (body + the
    // attachment context block), so the redaction tokens surface in a rendered
    // message and we can assert they hydrate back to the originals.
    await page.getByLabel(COMPOSER_LABEL).fill('[echo] summarise the attached file');
    const send = page.getByRole('button', { name: /^send$/i });
    await expect(send).toBeEnabled();
    await send.click();

    // Bug 1: the mapping is associated with the conversation, so the placeholder
    // hydrates to the original value (rendered as a redacted pill) — not shown raw.
    await expect(page.getByText(email).first()).toBeVisible();
    await expect(page.getByText(iban).first()).toBeVisible();
    await expect(page.locator('body')).not.toContainText('[[PII_EMAIL_');

    // The owner sees the file chip on their message (resolved state).
    await expect(page.getByTestId('message-attachment-chip')).toContainText(
      'sensitive.md',
    );

    // Bug 2: after a reload the attachment message decrypts and the tokens still
    // hydrate from the persisted, conversation-scoped mappings.
    await page.reload();
    await expect(page.locator('body')).not.toContainText('Failed to decrypt message');
    await expect(page.getByText(email).first()).toBeVisible();
    await expect(page.locator('body')).not.toContainText('[[PII_EMAIL_');
    // The chip still resolves to the library file after reload.
    await expect(page.getByTestId('message-attachment-chip')).toContainText(
      'sensitive.md',
    );
  });

  test('the message file chip downloads the decrypted file', async ({ page }) => {
    await provisionUnlockedAccount(page);
    await expect(page.getByTestId('attach-button')).toBeVisible();

    const body = 'the quick brown fox';
    await setComposerFile(page, 'cognos_test.txt', 'text/plain', body);
    await expect(page.getByTestId('attachment-chip')).toContainText('cognos_test.txt');

    await page.getByLabel(COMPOSER_LABEL).fill('whats in the file?');
    const send = page.getByRole('button', { name: /^send$/i });
    await expect(send).toBeEnabled();
    await send.click();
    await expect(page.getByText('Mocked assistant reply')).toBeVisible();

    const chip = page.getByTestId('message-attachment-chip');
    await expect(chip).toContainText('cognos_test.txt');

    // Clicking the chip downloads the decrypted original bytes.
    const downloadPromise = page.waitForEvent('download');
    await chip.click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toBe('cognos_test.txt');
  });

  test('attaches a previously uploaded file from the library', async ({ page }) => {
    await provisionUnlockedAccount(page);
    await expect(page.getByTestId('attach-button')).toBeVisible();

    // Upload + send so the file lands in the user's library.
    await setComposerFile(
      page,
      'libfile.txt',
      'text/plain',
      'reusable library content',
    );
    await expect(page.getByTestId('attachment-chip')).toContainText('libfile.txt');
    await page.getByLabel(COMPOSER_LABEL).fill('first use of the file');
    await page.getByRole('button', { name: /^send$/i }).click();
    await expect(page.getByText('Mocked assistant reply')).toBeVisible();
    await expect(page.getByTestId('attachment-chip')).toHaveCount(0);

    // Re-attach the same file via the library picker (no re-upload).
    await page.getByTestId('attach-button').click();
    await page.getByTestId('attach-from-library').click();
    const list = page.getByTestId('library-list');
    await expect(list).toContainText('libfile.txt');
    await list.getByText('libfile.txt').click();
    await page.getByTestId('library-attach-selected').click();

    // It appears as a ready composer attachment again.
    await expect(page.getByTestId('attachment-chip')).toContainText('libfile.txt');
    await page.getByLabel(COMPOSER_LABEL).fill('reuse the file');
    const send = page.getByRole('button', { name: /^send$/i });
    await expect(send).toBeEnabled();
    await send.click();
    await expect(page.getByText('Mocked assistant reply').nth(1)).toBeVisible();
  });

  test('reusing a redacted library file in a new chat hydrates its placeholders', async ({
    page,
  }) => {
    await provisionUnlockedAccount(page);
    await expect(page.getByTestId('attach-button')).toBeVisible();

    const iban = 'DE75512108001245126199';
    // Upload a file with PII in chat A — redacted at processing, mappings stored
    // in the manifest and added to chat A's redaction scope on send.
    await setComposerFile(page, 'cognos_test.txt', 'text/plain', `My IBAN is ${iban}`);
    await expect(page.getByTestId('attachment-chip')).toContainText('cognos_test.txt');
    await page.getByLabel(COMPOSER_LABEL).fill('first chat');
    await page.getByRole('button', { name: /^send$/i }).click();
    await expect(page.getByText('Mocked assistant reply')).toBeVisible();

    // Start a NEW chat and reuse the same file from the library.
    await page.getByRole('button', { name: /new chat/i }).click();
    await page.getByTestId('attach-button').click();
    await page.getByTestId('attach-from-library').click();
    await page.getByTestId('library-list').getByText('cognos_test.txt').click();
    await page.getByTestId('library-attach-selected').click();
    await expect(page.getByTestId('attachment-chip')).toContainText('cognos_test.txt');

    // `[echo]` returns the assembled turn (incl. the redacted attachment block),
    // so its tokens render and must hydrate — proving the file's mappings were
    // merged into THIS new conversation, not only the one it was uploaded in.
    await page.getByLabel(COMPOSER_LABEL).fill("[echo] what's my iban?");
    const send = page.getByRole('button', { name: /^send$/i });
    await expect(send).toBeEnabled();
    await send.click();

    await expect(page.getByText(iban).first()).toBeVisible();
    await expect(page.locator('body')).not.toContainText('[[PII_IBAN_');
  });

  test('keeps an attachment available to the model on follow-up messages', async ({
    page,
  }) => {
    await provisionUnlockedAccount(page);
    await expect(page.getByTestId('attach-button')).toBeVisible();

    // Capture the attachment_contexts on every completion request.
    const sentContexts: Array<Array<{ attachment_id?: string }>> = [];
    await page.route('**/complete', async (route) => {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON() as {
          attachment_contexts?: Array<{ attachment_id?: string }>;
        };
        sentContexts.push(body.attachment_contexts ?? []);
      }
      await route.continue();
    });

    await setComposerFile(
      page,
      'cognos_test.txt',
      'text/plain',
      'My IBAN is DE75512108001245126199',
    );
    await expect(page.getByTestId('attachment-chip')).toContainText('cognos_test.txt');
    await page.getByLabel(COMPOSER_LABEL).fill("what's my iban?");
    await page.getByRole('button', { name: /^send$/i }).click();
    await expect(page.getByText('Mocked assistant reply')).toBeVisible();

    const beforeFollowUp = sentContexts.length;

    // Follow-up turn with NO new attachment.
    await page.getByLabel(COMPOSER_LABEL).fill("what's my name?");
    await page.getByRole('button', { name: /^send$/i }).click();
    await expect(page.getByText('Mocked assistant reply')).toHaveCount(2);

    // The follow-up completion must still carry the attachment context, so the
    // stateless model can answer about the file it was given earlier.
    const followUpRequests = sentContexts.slice(beforeFollowUp);
    expect(followUpRequests.length).toBeGreaterThan(0);
    expect(
      followUpRequests.some((contexts) => contexts.some((c) => !!c.attachment_id)),
    ).toBe(true);
  });

  test('dedupes an identical re-upload to a single library entry', async ({ page }) => {
    await provisionUnlockedAccount(page);
    await expect(page.getByTestId('attach-button')).toBeVisible();

    const content = 'identical bytes for dedup';
    await setComposerFile(page, 'dup.txt', 'text/plain', content);
    await expect(page.getByTestId('attachment-chip')).toContainText('dup.txt');
    await page.getByLabel(COMPOSER_LABEL).fill('first');
    await page.getByRole('button', { name: /^send$/i }).click();
    await expect(page.getByText('Mocked assistant reply')).toBeVisible();

    // Re-select the exact same file: it is reused from the library, not uploaded
    // again, so the library still holds a single entry.
    await setComposerFile(page, 'dup.txt', 'text/plain', content);
    await expect(page.getByTestId('attachment-chip')).toContainText('dup.txt');

    await page.getByTestId('attach-button').click();
    await page.getByTestId('attach-from-library').click();
    await expect(page.getByTestId('library-list').locator('li')).toHaveCount(1);
  });

  test('library page renames a file and removing it tombstones it in chats', async ({
    page,
  }) => {
    await provisionUnlockedAccount(page);
    await expect(page.getByTestId('attach-button')).toBeVisible();

    await setComposerFile(page, 'managed.txt', 'text/plain', 'managed library file');
    await expect(page.getByTestId('attachment-chip')).toContainText('managed.txt');
    await page.getByLabel(COMPOSER_LABEL).fill('use the managed file');
    await page.getByRole('button', { name: /^send$/i }).click();
    await expect(page.getByText('Mocked assistant reply')).toBeVisible();
    const chatUrl = page.url();

    // Open the library management page.
    await page.goto('/account/library');
    const list = page.getByTestId('library-page-list');
    await expect(list).toContainText('managed.txt');

    // Open the file's action sheet and rename it.
    await page.getByRole('button', { name: 'File actions' }).first().click();
    await page.getByRole('button', { name: 'Rename' }).click();
    await page.getByTestId('library-rename-input').fill('renamed.txt');
    await page.getByRole('button', { name: 'Save' }).click();
    await expect(list).toContainText('renamed.txt');

    // The reference count links to the chats that use the file: click it and
    // follow the link back to the conversation. Use an exact name so we hit the
    // reference button, not the card (whose a11y name includes the same text).
    await page.getByRole('button', { name: 'In 1 chats', exact: true }).click();
    const usages = page.getByTestId('library-usages-list');
    await expect(usages.getByRole('link')).toHaveCount(1);
    await usages.getByRole('link').first().click();
    await expect(page).toHaveURL(chatUrl);

    // Return to the library, open the action sheet again, and remove it.
    await page.goto('/account/library');
    await page.getByRole('button', { name: 'File actions' }).first().click();
    await page.getByRole('button', { name: 'Remove' }).click();
    await page.getByRole('button', { name: 'Yes' }).click();
    await expect(page.getByTestId('library-page-list')).toHaveCount(0);

    // Back in the chat that used it, the message now shows a removed tombstone.
    await page.goto(chatUrl);
    await expect(page.getByTestId('message-attachment-tombstone')).toBeVisible();
    await expect(page.getByTestId('message-attachment-chip')).toHaveCount(0);
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
