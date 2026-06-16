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
  // Default: no card / no invoices. Tests that need them override this route.
  await page.route(`${API}/api/v1/billing/invoices`, async (route) => {
    await route.fulfill({ json: { card: null, invoices: [] } });
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

test('PAYG usage headline shows spend in CHF, not a message count', async ({
  page,
}) => {
  const userFixture = buildVaultFixture('user_payg', 'payg@example.com');
  await seedAuth(page, userFixture);
  await page.route(`${API}/api/v1/billing`, async (route) => {
    await route.fulfill({
      json: {
        plan_type: 'payg',
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

  // Billing is token-cost based, so PAYG leads with francs (sum of by_model
  // cost_chf = 6.80), not the message count.
  await expect(page.locator('.pb__usage-total')).toHaveText('CHF 6.80');
  await expect(page.getByText(/spent since/)).toBeVisible();
  await expect(page.getByText(/messages since/)).toHaveCount(0);
});

test('dashboard renders the saved card and Paddle invoices', async ({ page }) => {
  const userFixture = buildVaultFixture('user_inv', 'inv@example.com');
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
        refund_eligible_until_at: '2099-01-01T00:00:00Z',
      },
    });
  });
  await page.route(`${API}/api/v1/billing/usage`, async (route) => {
    await route.fulfill({ json: usageJson });
  });
  // Override the default empty invoices route with a real card + invoices.
  await page.route(`${API}/api/v1/billing/invoices`, async (route) => {
    await route.fulfill({
      json: {
        card: { brand: 'visa', last4: '4242', expiry_month: 9, expiry_year: 2028 },
        invoices: [
          {
            id: 'txn_1',
            invoice_number: 'CG-26-0002',
            status: 'paid',
            currency: 'CHF',
            amount_minor: 10000,
            billed_at: '2026-04-14T00:00:00Z',
          },
        ],
      },
    });
  });

  await page.goto('/account/billing');

  // Saved card replaces the "No card available" placeholder.
  await expect(page.getByText('Visa •••• 4242')).toBeVisible();
  await expect(page.getByText('Expires 09 / 2028')).toBeVisible();
  await expect(page.getByText('No card available')).toHaveCount(0);

  // Invoice row with number, status and amount.
  await expect(page.getByText('Invoice CG-26-0002')).toBeVisible();
  await expect(page.getByText('Paid', { exact: true })).toBeVisible();
  await expect(page.getByText('CHF 100.00')).toBeVisible();

  // The Paddle brand mark renders (Synced with Paddle + invoices footer).
  await expect(page.getByRole('img', { name: 'Paddle' }).first()).toBeVisible();

  // Within the refund window, the money-back guarantee shows.
  await expect(page.getByText('60-day money-back guarantee')).toBeVisible();
});

test('the money-back guarantee hides once the refund window has lapsed', async ({
  page,
}) => {
  const userFixture = buildVaultFixture('user_norefund', 'norefund@example.com');
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
        refund_eligible_until_at: '2020-01-01T00:00:00Z', // lapsed
      },
    });
  });
  await page.route(`${API}/api/v1/billing/usage`, async (route) => {
    await route.fulfill({ json: usageJson });
  });

  await page.goto('/account/billing');

  await expect(page.getByRole('heading', { name: /Unlimited/ })).toBeVisible();
  await expect(page.getByText('60-day money-back guarantee')).toHaveCount(0);
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

  await expect(page).toHaveURL(/\/account$/);
  await expect(page.getByRole('heading', { name: 'Account' })).toBeVisible();
  await expect(page.getByText('coming soon')).toBeVisible();
});

test('switch-plan modal marks the current plan and switches to PAYG', async ({
  page,
}) => {
  const userFixture = buildVaultFixture('user_switch', 'switch@example.com');
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
  let changeBody: { plan?: string } | null = null;
  await page.route(`${API}/api/v1/billing/change-plan`, async (route) => {
    changeBody = route.request().postDataJSON();
    await route.fulfill({ json: { status: 'changed' } });
  });

  await page.goto('/account/billing');
  await page.getByRole('button', { name: 'Switch plan' }).click();

  // Modal opens with both plans + the billing-period toggle.
  await expect(page.getByRole('heading', { name: 'Switch plan' })).toBeVisible();
  await expect(page.getByText('Billing period')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Monthly' })).toBeVisible();
  await expect(page.getByRole('button', { name: /Yearly/ })).toBeVisible();

  // The current plan (Unlimited monthly) is marked and not switchable.
  const unlimitedCard = page.locator('.spm__plan').filter({ hasText: 'Unlimited' });
  await expect(unlimitedCard.locator('.spm__current')).toBeVisible();
  await expect(
    unlimitedCard.getByRole('button', { name: 'Current plan' }),
  ).toBeDisabled();

  // Switch to Pay as you go.
  const paygCard = page.locator('.spm__plan').filter({ hasText: 'Pay as you go' });
  await paygCard.getByRole('button', { name: 'Switch' }).click();

  await expect.poll(() => changeBody?.plan).toBe('payg');
  // Modal closes once the switch succeeds.
  await expect(page.getByRole('heading', { name: 'Switch plan' })).toBeHidden();
});

test('switch-plan modal yearly toggle switches Unlimited to annual', async ({
  page,
}) => {
  const userFixture = buildVaultFixture('user_switch_y', 'switchy@example.com');
  await seedAuth(page, userFixture);
  await page.route(`${API}/api/v1/billing`, async (route) => {
    await route.fulfill({
      json: {
        plan_type: 'payg',
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
  let changeBody: { plan?: string } | null = null;
  await page.route(`${API}/api/v1/billing/change-plan`, async (route) => {
    changeBody = route.request().postDataJSON();
    await route.fulfill({ json: { status: 'changed' } });
  });

  await page.goto('/account/billing');
  await page.getByRole('button', { name: 'Switch plan' }).click();

  // PAYG is current here.
  const paygCard = page.locator('.spm__plan').filter({ hasText: 'Pay as you go' });
  await expect(paygCard.getByRole('button', { name: 'Current plan' })).toBeDisabled();

  // Toggle to yearly, then switch to Unlimited → annual price id.
  await page.getByRole('button', { name: /Yearly/ }).click();
  const unlimitedCard = page.locator('.spm__plan').filter({ hasText: 'Unlimited' });
  await expect(unlimitedCard.getByText('/ year')).toBeVisible();
  await unlimitedCard.getByRole('button', { name: 'Switch' }).click();

  await expect.poll(() => changeBody?.plan).toBe('unlimited_annual');
});
