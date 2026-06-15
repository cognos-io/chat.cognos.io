import { Page, expect, test } from '@playwright/test';

import {
  VaultFixture,
  buildVaultFixture,
  seedAuthenticatedUnlockState,
} from './fixtures';

const API = 'http://localhost:8090';

const seedAuth = async (page: Page, userFixture: VaultFixture): Promise<void> => {
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

const usageJson = {
  period_start: '2026-06-01T00:00:00Z',
  message_count: 42,
  by_model: [{ model_id: 'eu-model', count: 42, cost_chf: 6.8 }],
};

test('active unlimited dashboard shows plan, renewal, usage and the settings nav', async ({
  page,
}) => {
  const userFixture = buildVaultFixture('user_dash', 'dash@example.com');
  await seedAuth(page, userFixture);
  await page.route(`${API}/api/v1/billing`, async (route) => {
    await route.fulfill({
      json: {
        plan_type: 'unlimited',
        status: 'active',
        interval: 'monthly',
        balance_chf: 0,
        trial_seed_chf: 0,
        cycle_end_at: '2026-07-01T00:00:00Z',
        cancel_at_period_end: false,
      },
    });
  });
  await page.route(`${API}/api/v1/billing/usage`, async (route) => {
    await route.fulfill({ json: usageJson });
  });

  await page.goto('/account/billing');

  // Settings nav present.
  await expect(page.getByRole('link', { name: 'Plan & billing' })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Security & keys' })).toBeVisible();

  // Plan card.
  await expect(page.getByRole('heading', { name: 'Plan & billing' })).toBeVisible();
  await expect(page.getByRole('heading', { name: /Unlimited/ })).toBeVisible();
  await expect(page.getByText('CHF 100 / month').first()).toBeVisible();
  await expect(page.getByText('Active', { exact: true })).toBeVisible();
  await expect(page.getByText('Renews')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Switch plan' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Cancel plan' })).toBeVisible();

  // Usage breakdown (count, from ledger metadata).
  await expect(page.getByText('42').first()).toBeVisible();
  await expect(page.getByText('No limit')).toBeVisible();

  // Payment method placeholder (card brand/last4 wired with live Paddle data).
  await expect(page.getByText('No card available')).toBeVisible();

  // Portal entry points appear once there's a Paddle customer (non-trial).
  await expect(page.getByRole('button', { name: 'Update' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open Paddle portal' })).toBeVisible();
});

test('cancels-soon dashboard offers resume', async ({ page }) => {
  const userFixture = buildVaultFixture('user_cancels', 'cancels@example.com');
  await seedAuth(page, userFixture);
  await page.route(`${API}/api/v1/billing`, async (route) => {
    await route.fulfill({
      json: {
        plan_type: 'unlimited',
        status: 'cancels_soon',
        interval: 'monthly',
        balance_chf: 0,
        trial_seed_chf: 0,
        cycle_end_at: '2026-07-01T00:00:00Z',
        cancel_at_period_end: true,
      },
    });
  });
  await page.route(`${API}/api/v1/billing/usage`, async (route) => {
    await route.fulfill({ json: usageJson });
  });
  await page.route(`${API}/api/v1/billing/resume`, async (route) => {
    await route.fulfill({ json: { status: 'active' } });
  });

  await page.goto('/account/billing');

  await expect(page.getByText('Cancels soon')).toBeVisible();
  await expect(page.getByText('Access until')).toBeVisible();

  const resumed = page.waitForRequest(
    (req) => req.url().includes('/billing/resume') && req.method() === 'POST',
  );
  await page.getByRole('button', { name: 'Resume plan' }).click();
  await resumed;
});

test('inactive dashboard is read-only and routes to plans', async ({ page }) => {
  const userFixture = buildVaultFixture('user_inact', 'inact@example.com');
  await seedAuth(page, userFixture);
  await page.route(`${API}/api/v1/billing`, async (route) => {
    await route.fulfill({
      json: {
        plan_type: 'inactive',
        status: 'inactive',
        previous_plan_type: 'unlimited',
        balance_chf: 0,
        trial_seed_chf: 0,
        cycle_end_at: '2026-05-14T00:00:00Z',
      },
    });
  });
  await page.route(`${API}/api/v1/billing/usage`, async (route) => {
    await route.fulfill({ json: usageJson });
  });

  await page.goto('/account/billing');

  await expect(page.getByText('Previous plan')).toBeVisible();
  await expect(page.getByText('Read-only')).toBeVisible();
  await expect(page.getByText('Ended')).toBeVisible();

  await page.getByRole('button', { name: 'Choose a plan' }).click();
  await expect(page).toHaveURL(/\/pricing/);
});

test('cancelling an active plan calls the cancel endpoint', async ({ page }) => {
  const userFixture = buildVaultFixture('user_cancel', 'cancel@example.com');
  await seedAuth(page, userFixture);
  await page.route(`${API}/api/v1/billing`, async (route) => {
    await route.fulfill({
      json: {
        plan_type: 'unlimited',
        status: 'active',
        interval: 'monthly',
        balance_chf: 0,
        trial_seed_chf: 0,
        cycle_end_at: '2026-07-01T00:00:00Z',
        cancel_at_period_end: false,
      },
    });
  });
  await page.route(`${API}/api/v1/billing/usage`, async (route) => {
    await route.fulfill({ json: usageJson });
  });
  await page.route(`${API}/api/v1/billing/cancel`, async (route) => {
    await route.fulfill({ json: { status: 'cancels_soon' } });
  });

  await page.goto('/account/billing');

  const canceled = page.waitForRequest(
    (req) => req.url().includes('/billing/cancel') && req.method() === 'POST',
  );
  await page.getByRole('button', { name: 'Cancel plan' }).click();
  await canceled;
});

test('mobile settings opens the nav via the hamburger drawer', async ({ page }) => {
  const userFixture = buildVaultFixture('user_mobile', 'mobile@example.com');
  await seedAuth(page, userFixture);
  await page.route(`${API}/api/v1/billing`, async (route) => {
    await route.fulfill({
      json: { plan_type: 'trial', status: 'trial', balance_chf: 1, trial_seed_chf: 2 },
    });
  });
  await page.route(`${API}/api/v1/billing/usage`, async (route) => {
    await route.fulfill({ json: usageJson });
  });

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/account/billing');

  // The content area must scroll on mobile (regression guard: the height chain
  // used to break, clipping content with no scroll).
  await expect(page.getByRole('heading', { name: 'Plan & billing' })).toBeVisible();
  const scrollable = await page
    .locator('.cog-mobile-shell__main')
    .evaluate((el) => el.scrollHeight > el.clientHeight);
  expect(scrollable).toBe(true);

  // The desktop sidebar is hidden; the nav lives behind the hamburger.
  const hamburger = page.getByRole('button', { name: 'Open navigation' });
  await expect(hamburger).toBeVisible();
  await hamburger.click();

  // The Settings nav is now reachable in the drawer.
  await page.getByRole('link', { name: 'Security & keys' }).click();
  await expect(page).toHaveURL(/\/account\/security/);
});

test('the settings nav opens placeholder sections', async ({ page }) => {
  const userFixture = buildVaultFixture('user_nav', 'nav@example.com');
  await seedAuth(page, userFixture);
  await page.route(`${API}/api/v1/billing`, async (route) => {
    await route.fulfill({
      json: { plan_type: 'trial', status: 'trial', balance_chf: 1, trial_seed_chf: 2 },
    });
  });
  await page.route(`${API}/api/v1/billing/usage`, async (route) => {
    await route.fulfill({ json: usageJson });
  });

  await page.goto('/account/billing');
  await page.getByRole('link', { name: 'Account', exact: true }).click();

  await expect(page).toHaveURL(/\/account\/account/);
  await expect(page.getByRole('heading', { name: 'Account' })).toBeVisible();
  await expect(page.getByText('coming soon')).toBeVisible();
});
