import { expect, test } from '@playwright/test';

import { buildVaultFixture, seedAuthenticatedUnlockState } from './fixtures';

const API = 'http://localhost:8090';

test('the pricing page presents both plans, the guarantee and a working interval toggle', async ({
  page,
}) => {
  const userFixture = buildVaultFixture('user_pricing', 'pricing@example.com');
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
  await page.route(`${API}/api/v1/billing`, async (route) => {
    await route.fulfill({
      json: { plan_type: 'trial', balance_chf: 0, trial_seed_chf: 2.0 },
    });
  });

  await page.goto('/account/billing');

  await expect(
    page.getByRole('heading', { name: 'Keep going, privately' }),
  ).toBeVisible();
  // Used-up trial surfaces the status pill.
  await expect(page.getByText('Trial credits used up')).toBeVisible();

  // Both plans are present with their badges and prices.
  await expect(page.getByRole('heading', { name: 'Pay as you go' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Unlimited' })).toBeVisible();
  await expect(page.getByText('CHF 10', { exact: true })).toBeVisible();
  await expect(page.getByText('CHF 100', { exact: true })).toBeVisible();

  // Guarantee + assurances + footer.
  await expect(page.getByText('60-day money-back guarantee')).toBeVisible();
  await expect(page.getByText('Trial chats stay readable')).toBeVisible();
  await expect(page.getByText(/Prices in CHF, incl\. VAT/)).toBeVisible();

  // Switching to yearly re-prices the Unlimited plan.
  await page.getByRole('button', { name: /Yearly/ }).click();
  await expect(page.getByText("CHF 1'000", { exact: true })).toBeVisible();

  // Choosing a plan is a placeholder until checkout lands.
  await page.getByRole('button', { name: 'Go Unlimited' }).click();
  await expect(page.getByText('Checkout coming soon')).toBeVisible();
});
