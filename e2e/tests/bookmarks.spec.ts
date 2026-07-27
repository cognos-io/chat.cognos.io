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

async function provisionUnlockedAccount(page: Page): Promise<void> {
  const account = makeTestAccount();
  await gotoRegister(page);
  await fillRegisterForm(page, account);
  await submitRegister(page, account);
  await expectAccountKeyDialogForNewUser(page);
  await captureGeneratedAccountKey(page);
  await copyAccountKey(page);
  await acknowledgeAccountKey(page);
  await createEncryptedBackup(page);
}

// Scope message-text assertions to the message list so they don't also match
// the minimap preview (which mirrors the same text once >1 turn exists).
function messageText(page: Page, text: string) {
  return page.locator('app-message-list').getByText(text, { exact: true }).first();
}

async function sendMessage(page: Page, content: string): Promise<void> {
  const replies = page
    .locator('app-message-list')
    .getByText('Mocked assistant reply', { exact: true });
  const replyCount = await replies.count();

  await page.getByLabel(COMPOSER_LABEL).fill(content);
  const send = page.getByRole('button', { name: /^send$/i });
  await expect(send).toBeEnabled();
  await send.click();
  await expect(messageText(page, content)).toBeVisible();
  await expect(replies).toHaveCount(replyCount + 1);
  await expect(page.getByRole('button', { name: /stop generating/i })).toHaveCount(0);
}

// Triple-click selects the whole paragraph and fires REAL pointer events, so
// Angular's mouseup HostListener runs inside the zone and the popover appears.
// (A synthetic dispatched MouseEvent does not drive change detection.)
async function selectMessageText(page: Page, content: string): Promise<void> {
  const markdown = page
    .locator('app-message-list app-redacted-markdown', { hasText: content })
    .first();
  await markdown.click({ clickCount: 3 });
}

test.describe('bookmarks', () => {
  test('bookmarks one of several messages, survives a branch, lists, jumps and removes', async ({
    page,
  }) => {
    await provisionUnlockedAccount(page);

    // A realistic multi-turn conversation; we bookmark the MIDDLE turn.
    await sendMessage(page, 'Bookmark alpha sentence one');
    await sendMessage(page, 'Bookmark bravo sentence two');
    await sendMessage(page, 'Bookmark charlie sentence three');

    await selectMessageText(page, 'Bookmark bravo sentence two');
    await page.getByRole('button', { name: /save to bookmarks/i }).click();
    await expect(page.getByText('Saved to bookmarks')).toBeVisible();

    // Fork the thread by editing a LATER turn — the bookmarked turn stays on the
    // active branch, so the bookmark must survive branching.
    const thirdTurn = page
      .locator('app-message-list article')
      .filter({ hasText: 'Bookmark charlie sentence three' });
    await thirdTurn.getByRole('button', { name: 'Edit message' }).click();
    await page
      .getByRole('textbox', { name: 'Edit message' })
      .fill('Bookmark delta branch three');
    await page.getByRole('button', { name: /^save$/i }).click();
    await expect(messageText(page, 'Bookmark delta branch three')).toBeVisible();
    await expect(messageText(page, 'Bookmark bravo sentence two')).toBeVisible();

    // It appears in the settings list (highlights aren't queryable, so the list
    // is the assertable surface).
    await page.goto('/account/bookmarks');
    await expect(page.getByText('Bookmark bravo sentence two')).toBeVisible();

    // Jump navigates back and scrolls the bookmarked message into view.
    await page.getByRole('button', { name: /^jump$/i }).click();
    await expect(page).toHaveURL(/\/c\//);
    await expect(messageText(page, 'Bookmark bravo sentence two')).toBeInViewport();

    // Remove it and confirm it's gone.
    await page.goto('/account/bookmarks');
    await page.getByRole('button', { name: /^remove$/i }).click();
    await expect(page.getByText('Bookmark removed')).toBeVisible();
    await expect(page.getByText('Bookmark bravo sentence two')).toHaveCount(0);
  });
});
