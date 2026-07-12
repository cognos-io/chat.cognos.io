import { expect, test } from '@playwright/test';

import { buildVaultFixture, seedAuthenticatedUnlockState } from './fixtures';

const API = 'http://localhost:8090';

const seed = async (
  page: Parameters<typeof seedAuthenticatedUnlockState>[0] & {
    route: (...args: never[]) => Promise<void>;
  },
  fixture: ReturnType<typeof buildVaultFixture>,
) => {
  await seedAuthenticatedUnlockState(page, fixture);
  await page.route(`${API}/api/v1/user-key-pair`, (r) =>
    r.fulfill({ json: fixture.userKeyPairRecord }),
  );
  await page.route(`${API}/api/v1/vault-session`, (r) =>
    r.fulfill({ json: fixture.vaultSession }),
  );
  await page.route(`${API}/api/v1/user-preferences`, (r) =>
    r.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Not found' }),
    }),
  );
  await page.route(`${API}/api/v1/conversations`, (r) => r.fulfill({ json: [] }));
  await page.route(`${API}/api/v1/models`, (r) =>
    r.fulfill({ json: { privacy_tier: 'eu', preferred_model_id: 'm', models: [] } }),
  );
  await page.route(`${API}/api/v1/billing`, (r) =>
    r.fulfill({
      json: { plan_type: 'trial', status: 'trial', balance_chf: 2, trial_seed_chf: 2 },
    }),
  );
  await page.route(`${API}/api/v1/billing/usage`, (r) =>
    r.fulfill({
      json: { period_start: '2026-06-01T00:00:00Z', message_count: 0, by_model: [] },
    }),
  );
};

const FLAGGED_SECTIONS = ['Usage', 'Team & sharing', 'Notifications'];

test('flagged-off settings sections are hidden from the nav', async ({ page }) => {
  const fixture = buildVaultFixture('user_e2e_flag01', 'flag@example.com');
  await seed(page, fixture);

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/account');

  // Account and Plan & billing remain.
  await expect(page.getByRole('link', { name: 'Account', exact: true })).toBeVisible();
  await expect(page.getByRole('link', { name: 'Plan & billing' })).toBeVisible();

  // The flagged-off sections must not be present in the settings nav.
  for (const label of FLAGGED_SECTIONS) {
    await expect(page.getByRole('link', { name: label })).toHaveCount(0);
  }
});

test('navigating directly to a flagged-off section redirects to /account', async ({
  page,
}) => {
  const fixture = buildVaultFixture('user_e2e_flag02', 'flag2@example.com');
  await seed(page, fixture);

  await page.setViewportSize({ width: 1280, height: 800 });

  for (const path of ['usage', 'team', 'notifications']) {
    await page.goto(`/account/${path}`);
    await expect(page).toHaveURL(/\/account$/);
  }
});
