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
const SEARCH_PLACEHOLDER = 'Search';

async function provisionUnlockedAccount(page: Page): Promise<void> {
  const account = makeTestAccount();
  await gotoRegister(page);
  await fillRegisterForm(page, account);
  await submitRegister(page);
  await expectAccountKeyDialogForNewUser(page);
  await captureGeneratedAccountKey(page);
  await copyAccountKey(page);
  await acknowledgeAccountKey(page);
  await createEncryptedBackup(page);
}

// Send a first message, which creates the conversation and persists the
// (encrypted) message the search index later hydrates.
async function sendFirstMessage(page: Page, content: string): Promise<void> {
  await page.getByLabel(COMPOSER_LABEL).fill(content);
  await page.getByRole('button', { name: /^send$/i }).click();
  await expect(page.getByText(content)).toBeVisible();
}

test.describe('conversation search', () => {
  test('finds a chat by a word in a recent message after on-device hydration', async ({
    page,
  }) => {
    await provisionUnlockedAccount(page);
    // A distinctive word that will not appear in any auto-generated title.
    await sendFirstMessage(page, 'Remind me about the zebracrossing clause please');

    const search = page.getByPlaceholder(SEARCH_PLACEHOLDER, { exact: true });
    const searchResultsHeading = page.getByText('Search results', { exact: true });

    // The on-device hint is always present beneath the search box.
    await expect(
      page.getByText('Searched on this device', { exact: true }),
    ).toBeVisible();

    // Under 3 characters: no search runs, normal navigation stays.
    await search.fill('ze');
    await expect(searchResultsHeading).toHaveCount(0);

    // Full query: the chat surfaces via its message content (not its title).
    await search.fill('zebracrossing');
    await expect(searchResultsHeading).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Mocked conversation title' }),
    ).toBeVisible();

    // A query with no hits shows the empty state once hydration settles.
    await search.fill('qwertyabsentterm');
    await expect(page.getByText('No matching chats', { exact: true })).toBeVisible();

    // Clearing restores the normal Projects/Pinned/Recent navigation.
    await search.fill('');
    await expect(searchResultsHeading).toHaveCount(0);
    await expect(page.getByText('Recent', { exact: true })).toBeVisible();
  });

  test('matches a project chat without expanding the project', async ({ page }) => {
    await provisionUnlockedAccount(page);

    // Create a project, then a chat inside it, and send a distinctive message.
    await page.goto('/account/projects');
    await page.getByPlaceholder('e.g. Acme launch').fill('Legal matters');
    await page.getByRole('button', { name: 'Create project' }).click();
    await expect(page.getByTestId('project-name')).toHaveText('Legal matters');

    await page.locator('.project-detail__chats-header').getByRole('button').click();
    await expect(page.getByLabel(COMPOSER_LABEL)).toBeVisible();
    await sendFirstMessage(page, 'Notes on the flamingosanctuary lease clause');

    // The sidebar excludes project chats from Recent, so none are listed until a
    // search surfaces them (spec §6.2: no need to expand the project first).
    const conversationLinks = page.locator('a[href^="/c/"]');
    await expect(conversationLinks).toHaveCount(0);

    const search = page.getByPlaceholder(SEARCH_PLACEHOLDER, { exact: true });
    await search.fill('flamingosanctuary');
    await expect(page.getByText('Search results', { exact: true })).toBeVisible();
    await expect(conversationLinks).toHaveCount(1);
  });
});
