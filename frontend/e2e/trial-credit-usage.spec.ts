import { Page, expect, test } from '@playwright/test';

import {
  VaultFixture,
  buildConversationFixture,
  buildVaultFixture,
  seedAuthenticatedUnlockState,
} from './fixtures';

const API = 'http://localhost:8090';
const CONVERSATION_ID = 'conv_trial_usage';

// The trial-credit card in the sidebar fills its meter as credit is consumed.
// The production bug left the balance pinned at the full seed, so the meter sat
// empty ("CHF 2.00 left of your CHF 2.00") no matter how many turns were sent.
// These tests pin the user-facing contract: a reduced balance must render as a
// reduced "left" amount AND a partially-filled meter.

const seedChatRoutes = async (page: Page, userFixture: VaultFixture): Promise<void> => {
  const conversationFixture = buildConversationFixture(
    userFixture,
    CONVERSATION_ID,
    'Trial usage',
  );

  await seedAuthenticatedUnlockState(page, userFixture);

  await page.route(`${API}/api/v1/user-key-pair`, async (route) => {
    await route.fulfill({ json: userFixture.userKeyPairRecord });
  });
  await page.route(`${API}/api/v1/vault-session`, async (route) => {
    await route.fulfill({ json: userFixture.vaultSession });
  });
  await page.route(`${API}/api/v1/user-preferences`, async (route) => {
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Not found' }),
    });
  });
  await page.route(`${API}/api/v1/conversations`, async (route) => {
    await route.fulfill({ json: [conversationFixture.conversationRecord] });
  });
  await page.route(
    `${API}/api/v1/conversations/${CONVERSATION_ID}/public-key`,
    async (route) => {
      await route.fulfill({ json: conversationFixture.conversationPublicKeyRecord });
    },
  );
  await page.route(
    `${API}/api/v1/conversations/${CONVERSATION_ID}/secret-key`,
    async (route) => {
      await route.fulfill({ json: conversationFixture.conversationSecretKeyRecord });
    },
  );
  await page.route(
    `${API}/api/v1/conversations/${CONVERSATION_ID}/messages?page=1&page_size=100`,
    async (route) => {
      await route.fulfill({
        json: { page: 1, perPage: 100, totalItems: 0, totalPages: 1, items: [] },
      });
    },
  );
};

const gotoChat = async (page: Page): Promise<void> => {
  const messagesLoaded = page.waitForResponse((res) =>
    res.url().includes(`/conversations/${CONVERSATION_ID}/messages`),
  );
  await page.goto(`/c/${CONVERSATION_ID}`);
  await messagesLoaded;
};

test('a partially-consumed trial fills the meter and shows the reduced balance', async ({
  page,
}) => {
  const userFixture = buildVaultFixture('user_trial_usage', 'trial-usage@example.com');
  await seedChatRoutes(page, userFixture);

  // CHF 0.74 of a CHF 2.00 trial has been spent → 37% consumed.
  await page.route(`${API}/api/v1/billing`, async (route) => {
    await route.fulfill({
      json: { plan_type: 'trial', balance_chf: 1.26, trial_seed_chf: 2.0 },
    });
  });

  await gotoChat(page);

  const card = page.locator('app-trial-credit-card');
  await expect(card.getByText('CHF 1.26 left of your CHF 2.00 trial')).toBeVisible();

  // The meter must reflect the consumed fraction — the exact value that was
  // stuck at 0 while the bug suppressed every debit.
  const meter = card.getByRole('progressbar');
  await expect(meter).toHaveAttribute('aria-valuenow', '37');
});

test('a fully-consumed trial flips to the used-up state', async ({ page }) => {
  const userFixture = buildVaultFixture('user_trial_done', 'trial-done@example.com');
  await seedChatRoutes(page, userFixture);

  await page.route(`${API}/api/v1/billing`, async (route) => {
    await route.fulfill({
      json: { plan_type: 'trial', balance_chf: 0, trial_seed_chf: 2.0 },
    });
  });

  await gotoChat(page);

  const card = page.locator('app-trial-credit-card');
  await expect(card.getByText('Used up')).toBeVisible();
  await expect(card.getByText('CHF 0.00 left of your CHF 2.00 trial')).toBeVisible();
  await expect(card.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '100');
});
