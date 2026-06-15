import { Page, expect, test } from '@playwright/test';

import {
  VaultFixture,
  buildVaultFixture,
  seedAuthenticatedUnlockState,
} from './fixtures';

const API = 'http://localhost:8090';

// Stubs the auth/unlock + preferences calls the app makes on load.
const seedPricingAuth = async (
  page: Page,
  userFixture: VaultFixture,
): Promise<void> => {
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
};

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
});

test('choosing a plan creates a checkout and redirects to the Paddle URL', async ({
  page,
}) => {
  const userFixture = buildVaultFixture('user_checkout', 'checkout@example.com');
  await seedPricingAuth(page, userFixture);
  await page.route(`${API}/api/v1/billing`, async (route) => {
    await route.fulfill({
      json: { plan_type: 'trial', balance_chf: 0, trial_seed_chf: 2.0 },
    });
  });

  let checkoutBody: { plan?: string; return_url?: string } | null = null;
  await page.route(`${API}/api/v1/billing/checkout`, async (route) => {
    checkoutBody = route.request().postDataJSON();
    await route.fulfill({
      json: { checkout_url: 'http://127.0.0.1:4201/__paddle_stub' },
    });
  });
  // Stand in for Paddle's hosted checkout so the redirect lands somewhere.
  await page.route('http://127.0.0.1:4201/__paddle_stub', async (route) => {
    await route.fulfill({ contentType: 'text/html', body: '<h1>Paddle checkout</h1>' });
  });

  await page.goto('/account/billing');
  await page.getByRole('button', { name: 'Go Unlimited' }).click();

  // The browser is redirected to the Paddle checkout URL the backend returned.
  await page.waitForURL('**/__paddle_stub');
  expect(checkoutBody?.plan).toBe('unlimited_monthly');
  expect(checkoutBody?.return_url).toContain('/account/billing?status=activating');
});

test('the yearly toggle switches the Unlimited checkout to the annual plan', async ({
  page,
}) => {
  const userFixture = buildVaultFixture('user_annual', 'annual@example.com');
  await seedPricingAuth(page, userFixture);
  await page.route(`${API}/api/v1/billing`, async (route) => {
    await route.fulfill({
      json: { plan_type: 'trial', balance_chf: 0, trial_seed_chf: 2.0 },
    });
  });

  let checkoutBody: { plan?: string } | null = null;
  await page.route(`${API}/api/v1/billing/checkout`, async (route) => {
    checkoutBody = route.request().postDataJSON();
    await route.fulfill({
      json: { checkout_url: 'http://127.0.0.1:4201/__paddle_stub' },
    });
  });
  await page.route('http://127.0.0.1:4201/__paddle_stub', async (route) => {
    await route.fulfill({ contentType: 'text/html', body: '<h1>stub</h1>' });
  });

  await page.goto('/account/billing');
  await page.getByRole('button', { name: /Yearly/ }).click();
  await page.getByRole('button', { name: 'Go Unlimited' }).click();

  await page.waitForURL('**/__paddle_stub');
  expect(checkoutBody?.plan).toBe('unlimited_annual');
});

test('returning from checkout shows activating, then drops back into chat once active', async ({
  page,
}) => {
  const userFixture = buildVaultFixture('user_activate', 'activate@example.com');
  await seedPricingAuth(page, userFixture);

  // The subscription.created webhook lands asynchronously: stay trial for the
  // first couple of polls, then flip to a paid plan.
  let billingCalls = 0;
  await page.route(`${API}/api/v1/billing`, async (route) => {
    billingCalls += 1;
    const planType = billingCalls >= 3 ? 'unlimited' : 'trial';
    await route.fulfill({
      json: { plan_type: planType, balance_chf: 0, trial_seed_chf: 2.0 },
    });
  });
  // Minimal chat-shell stubs so the post-activation route resolves cleanly.
  await page.route(`${API}/api/v1/models`, async (route) => {
    await route.fulfill({ json: { privacy_tier: 'eu', models: [] } });
  });
  await page.route(`${API}/api/v1/conversations`, async (route) => {
    await route.fulfill({ json: [] });
  });

  await page.goto('/account/billing?status=activating');

  await expect(page.getByText('Activating your plan…')).toBeVisible();
  // Once the plan flips, the user is returned to the chat.
  await page.waitForURL('http://127.0.0.1:4201/');
});
