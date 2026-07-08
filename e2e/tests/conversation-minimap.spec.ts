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

// The same text appears in the message bubble AND (once >1 turn) in the minimap
// preview, so scope message-text assertions to the message list to avoid
// strict-mode violations against the minimap's own preview.
function messageText(page: Page, text: string) {
  return page.locator('app-message-list').getByText(text, { exact: true }).first();
}

async function sendMessage(page: Page, content: string): Promise<void> {
  await page.getByLabel(COMPOSER_LABEL).fill(content);
  await page.getByRole('button', { name: /^send$/i }).click();
  await expect(messageText(page, content)).toBeVisible();
}

test.describe('conversation minimap', () => {
  test('tracks the active branch across multiple turns and branch switches', async ({
    page,
  }) => {
    await provisionUnlockedAccount(page);

    // A realistic multi-turn conversation.
    await sendMessage(page, 'Minimap alpha question one');
    await sendMessage(page, 'Minimap bravo question two');
    await sendMessage(page, 'Minimap charlie question three');

    const minimap = page.getByTestId('conversation-minimap');
    const ticks = page.getByTestId('minimap-tick');
    await expect(minimap).toBeVisible();

    // One tick per USER turn (assistant replies excluded).
    await expect(ticks).toHaveCount(3);

    // Hovering the oldest tick reveals its preview.
    await ticks.first().hover();
    const preview = ticks.first().getByTestId('minimap-preview');
    await expect(preview).toBeVisible();
    await expect(preview).toHaveText(/Minimap alpha question one/);
    const tickBox = await ticks.first().boundingBox();
    const previewBox = await preview.boundingBox();
    expect(tickBox).not.toBeNull();
    expect(previewBox).not.toBeNull();
    const previewRight = previewBox!.x + previewBox!.width;
    expect(previewRight).toBeLessThanOrEqual(tickBox!.x + 1);
    expect(previewBox!.x).toBeGreaterThanOrEqual(0);
    expect(previewBox!.y).toBeGreaterThanOrEqual(0);

    // Clicking a tick jumps to that turn.
    await ticks.first().click();
    await expect(messageText(page, 'Minimap alpha question one')).toBeInViewport();

    // Fork the thread: editing the 2nd user turn starts a new branch, dropping
    // the 3rd turn from the active path.
    const secondTurn = page
      .locator('app-message-list article')
      .filter({ hasText: 'Minimap bravo question two' });
    await secondTurn.getByRole('button', { name: 'Edit message' }).click();
    await page
      .getByRole('textbox', { name: 'Edit message' })
      .fill('Minimap delta branch two');
    await page.getByRole('button', { name: /^save$/i }).click();

    // The minimap now reflects the active branch: alpha + the edited turn only.
    await expect(messageText(page, 'Minimap delta branch two')).toBeVisible();
    await expect(ticks).toHaveCount(2);
    await expect(ticks.nth(1)).toHaveAccessibleName(/Minimap delta branch two/);

    // Switching back to the original branch restores the 3rd turn → 3 ticks.
    await page.getByRole('button', { name: 'Previous response' }).first().click();
    await expect(messageText(page, 'Minimap charlie question three')).toBeVisible();
    await expect(ticks).toHaveCount(3);
  });

  test('is not shown until there is more than one user turn', async ({ page }) => {
    await provisionUnlockedAccount(page);
    await sendMessage(page, 'Only one minimap turn so far');
    await expect(page.getByTestId('conversation-minimap')).toHaveCount(0);
  });
});
