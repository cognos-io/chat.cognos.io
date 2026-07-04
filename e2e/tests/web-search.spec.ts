import { Page, expect, test } from '@playwright/test';

import { setModelFlag } from './api-helpers';
import { makeTestAccount } from './fixtures';
import {
  acknowledgeAccountKey,
  captureGeneratedAccountKey,
  createEncryptedBackup,
  expectAccountKeyDialogForNewUser,
  fillRegisterForm,
  gotoRegister,
  submitRegister,
} from './helpers';

// A Requesty (EU) model. Web search ships off in prod, so the suite flips
// supports_web_search on at runtime via the superuser (beforeAll) and off again
// afterwards. Mirrors web-search-api.spec.ts so the same mock fixtures fire.
const WEB_SEARCH_MODEL_ID = 'claude-sonnet-4-6';
const WEB_SEARCH_MODEL_NAME = 'Claude Sonnet 4.6';

// The mock provider (cmd/mock-ai-provider) returns this accented reply and
// anchors a citation onto "légal" whenever the web_search tool is on the wire.
// The proxy URL is a Vertex grounding-redirect link; its displayable domain
// lives in the citation title (example.com), which is what the UI must show.
// The inline citation chip is inserted right after the anchored word "légal",
// splitting the reply's text node — so assert on a contiguous tail fragment.
const MOCK_REPLY_TAIL = 'est fixé par le canton.';
// citation[0]: the annotation source (real URL + domain title). The chip and the
// first source row both resolve to this.
const MOCK_CITATION_URL = 'https://example.com/geneva-minimum-wage';
const MOCK_CITATION_TITLE = 'example.com';
// citation[1]: the title-less grounding-redirect proxy source. Its host must
// never surface as a label — the UI shows a generic fallback instead.
const MOCK_SOURCE_PROXY_HOST = 'vertexaisearch.cloud.google.com';

const MESSAGE_LABEL =
  'Message Cognos — stored encrypted; sent to your provider to reply';

async function provisionUnlockedAccount(page: Page): Promise<void> {
  const account = makeTestAccount();
  await gotoRegister(page);
  await fillRegisterForm(page, account);
  await submitRegister(page, account);
  await expectAccountKeyDialogForNewUser(page);
  await captureGeneratedAccountKey(page);
  await acknowledgeAccountKey(page);
  await createEncryptedBackup(page);
}

async function selectWebSearchModel(page: Page): Promise<void> {
  const trigger = page.locator('.message-form__model');
  await expect(trigger).toBeVisible();
  await trigger.click();
  const option = page
    .getByRole('option')
    .filter({ hasText: WEB_SEARCH_MODEL_NAME })
    .first();
  await option.waitFor();
  await option.click();
  await expect(trigger).toContainText(WEB_SEARCH_MODEL_NAME);
}

async function sendWebSearchQuery(page: Page): Promise<void> {
  await page.getByLabel(MESSAGE_LABEL).fill('What is the minimum wage in Geneva?');
  await page.getByRole('button', { name: /^send$/i }).click();
  await expect(page.getByText(MOCK_REPLY_TAIL)).toBeVisible();
}

test.describe('web search', () => {
  test.beforeAll(async () => {
    await setModelFlag(WEB_SEARCH_MODEL_ID, 'supports_web_search', true);
  });

  test.afterAll(async () => {
    await setModelFlag(WEB_SEARCH_MODEL_ID, 'supports_web_search', false);
  });

  test('capable model shows the strength pill and an on-by-default toggle', async ({
    page,
  }) => {
    await provisionUnlockedAccount(page);

    // The model picker shows the Web search strength pill for the capable model.
    await page.locator('.message-form__model').click();
    const option = page
      .getByRole('option')
      .filter({ hasText: WEB_SEARCH_MODEL_NAME })
      .first();
    await option.waitFor();
    await expect(option).toContainText(/web search/i);
    await option.click();

    // The Tools menu row is a live toggle, on by default for a capable model.
    await page.getByRole('button', { name: 'Tools' }).click();
    const toggle = page.locator('app-composer-tools').getByRole('switch').first();
    await expect(toggle).toBeVisible();
    await expect(toggle).toBeChecked();
    await expect(toggle).toBeEnabled();
  });

  test('sources dropdown, inline citation marker + hover card, and reload', async ({
    page,
  }) => {
    await provisionUnlockedAccount(page);
    await selectWebSearchModel(page);
    await sendWebSearchQuery(page);

    // --- Sources dropdown: collapsed by default, expandable, whole-row links ---
    const sources = page.locator('app-message-sources');
    await expect(sources).toBeVisible();
    const disclosure = sources.getByRole('button').first();
    await expect(disclosure).toContainText(/searched \d+ sources?/i);
    await expect(disclosure).toHaveAttribute('aria-expanded', 'false');
    await expect(sources.getByRole('link')).toHaveCount(0);

    await disclosure.click();
    await expect(disclosure).toHaveAttribute('aria-expanded', 'true');
    // The proxy host is never shown as a label — the domain title is.
    await expect(sources).toContainText(MOCK_CITATION_TITLE);
    await expect(sources).not.toContainText(MOCK_SOURCE_PROXY_HOST);
    // The first row (citation 0) links to its real source URL, safely.
    const row = sources.getByRole('link').first();
    await expect(row).toBeVisible();
    await expect(row).toHaveAttribute('href', MOCK_CITATION_URL);
    await expect(row).toHaveAttribute('target', '_blank');
    await expect(row).toHaveAttribute('rel', /noopener/);

    // --- Inline citation marker + hover card ---
    const marker = page.locator('app-citation-marker button').first();
    await expect(marker).toBeVisible();
    await expect(marker).toHaveText('1');
    await marker.hover(); // hover reveals the card
    const openLink = page
      .locator('app-citation-marker a')
      .filter({ hasText: /open source/i })
      .first();
    await expect(openLink).toBeVisible();
    await expect(openLink).toHaveAttribute('href', MOCK_CITATION_URL);
    await expect(openLink).toHaveAttribute('target', '_blank');
    await expect(openLink).toHaveAttribute('rel', /noopener/);

    // --- Sources survive a reload (decrypted from the persisted message) ---
    await page.reload();
    await expect(page.getByText(MOCK_REPLY_TAIL)).toBeVisible();
    await expect(page.locator('app-message-sources')).toBeVisible();
    await expect(page.locator('app-citation-marker button').first()).toBeVisible();
  });
});
