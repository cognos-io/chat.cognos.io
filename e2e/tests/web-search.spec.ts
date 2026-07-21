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
// The annotation URL is a grounding-redirect PROXY link that the backend
// resolves server-side to the real destination before streaming/persisting —
// so the UI must show the destination URL with the domain title.
// The inline citation chip is inserted right after the anchored word "légal",
// splitting the reply's text node — so assert on a contiguous tail fragment.
const MOCK_REPLY_TAIL = 'est fixé par le canton.';
// citation[0]: the annotation source, post-resolution (destination URL,
// domain title). The chip and the first source row both resolve to this.
const MOCK_CITATION_URL = 'https://www.ge.ch/geneva-minimum-wage-2026';
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
    // No referrer leaks the chat origin: rel carries both tokens (spec).
    await expect(row).toHaveAttribute('rel', /noopener/);
    await expect(row).toHaveAttribute('rel', /noreferrer/);

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
    await expect(openLink).toHaveAttribute('rel', /noreferrer/);

    // --- Hover card keyboard access: focus opens it, Escape closes it ---
    await page.mouse.move(0, 0); // drop the hover so focus alone drives the card
    await expect(openLink).toBeHidden();
    await marker.focus();
    await expect(openLink).toBeVisible();
    await marker.press('Escape');
    await expect(openLink).toBeHidden();

    // --- Sources survive a reload (decrypted from the persisted message) ---
    await page.reload();
    await expect(page.getByText(MOCK_REPLY_TAIL)).toBeVisible();
    await expect(page.locator('app-message-sources')).toBeVisible();
    await expect(page.locator('app-citation-marker button').first()).toBeVisible();
  });

  // The hover-intent "safe triangle": moving the pointer from the citation
  // number, across the gap, into the card must keep the card open long enough
  // to click "Open source". This is the user's exact repro of the closing-gap
  // bug (docs/business_processes/web-search.md + the cogHoverIntent primitive).
  test('safe triangle keeps the hover card open across the gap to Open source', async ({
    page,
  }) => {
    await provisionUnlockedAccount(page);
    await selectWebSearchModel(page);
    await sendWebSearchQuery(page);

    const marker = page.locator('app-citation-marker button').first();
    await expect(marker).toBeVisible();
    await marker.scrollIntoViewIfNeeded();
    await marker.hover();

    const card = page.locator('app-citation-marker [role="dialog"]').first();
    await expect(card).toBeVisible();
    const openLink = page
      .locator('app-citation-marker a')
      .filter({ hasText: /open source/i })
      .first();
    await expect(openLink).toBeVisible();

    // Move slowly from the marker into the card centre. A straight path stays
    // inside the funnel, so the card must not close mid-traverse.
    const box = await card.boundingBox();
    if (!box) throw new Error('hover card has no box');
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 25 });
    await expect(openLink).toBeVisible();

    // Don't let the external source actually navigate in CI; the popup event
    // still fires, proving the link was reachable and clickable.
    await page.context().route('https://www.ge.ch/**', (route) => route.abort());
    const popupPromise = page.waitForEvent('popup');
    await openLink.click();
    const popup = await popupPromise;
    expect(popup).toBeTruthy();
    await popup.close();
  });

  test('moving the pointer away from the funnel closes the hover card', async ({
    page,
  }) => {
    await provisionUnlockedAccount(page);
    await selectWebSearchModel(page);
    await sendWebSearchQuery(page);

    const marker = page.locator('app-citation-marker button').first();
    await expect(marker).toBeVisible();
    await marker.scrollIntoViewIfNeeded();
    const mb = await marker.boundingBox();
    if (!mb) throw new Error('marker has no box');
    await marker.hover();

    const openLink = page
      .locator('app-citation-marker a')
      .filter({ hasText: /open source/i })
      .first();
    await expect(openLink).toBeVisible();

    // Move sideways at the marker's own height — the funnel narrows to a point
    // at the marker, so a horizontal move exits it immediately regardless of
    // whether the card was placed above or below. The card must close.
    await page.mouse.move(2, mb.y + mb.height / 2, { steps: 12 });
    await expect(openLink).toBeHidden();
  });

  test('near the viewport edge the hover card stays fully on-screen', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 520, height: 820 });
    await provisionUnlockedAccount(page);
    await selectWebSearchModel(page);
    await sendWebSearchQuery(page);

    const marker = page.locator('app-citation-marker button').first();
    await expect(marker).toBeVisible();
    await marker.scrollIntoViewIfNeeded();
    await marker.hover();

    const card = page.locator('app-citation-marker [role="dialog"]').first();
    await expect(card).toBeVisible();

    // The card is fully inside the viewport and never widens the page.
    const overflow = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth);

    const box = await card.boundingBox();
    if (!box) throw new Error('hover card has no box');
    expect(box.x).toBeGreaterThanOrEqual(0);
    expect(box.x + box.width).toBeLessThanOrEqual(overflow.clientWidth);

    // The funnel still works: the pointer can reach the card from the marker.
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 20 });
    await expect(
      page
        .locator('app-citation-marker a')
        .filter({ hasText: /open source/i })
        .first(),
    ).toBeVisible();
  });

  test('opting out sends no web search tool, so the reply has no sources', async ({
    page,
  }) => {
    await provisionUnlockedAccount(page);
    await selectWebSearchModel(page);

    // Turn web search OFF in the Tools menu before sending.
    await page.getByRole('button', { name: 'Tools' }).click();
    const toggle = page.locator('app-composer-tools').getByRole('switch').first();
    await expect(toggle).toBeChecked();
    await toggle.click();
    await expect(toggle).not.toBeChecked();
    await page.keyboard.press('Escape'); // dismiss the tools menu

    // With the tool dropped, the mock provider returns its default reply and no
    // citations (mirrors the "no tool on the wire" API-level assertion).
    await page.getByLabel(MESSAGE_LABEL).fill('What is the minimum wage in Geneva?');
    await page.getByRole('button', { name: /^send$/i }).click();
    await expect(page.getByText('Mocked assistant reply')).toBeVisible();

    await expect(page.locator('app-message-sources')).toHaveCount(0);
    await expect(page.locator('app-citation-marker')).toHaveCount(0);
  });
});
