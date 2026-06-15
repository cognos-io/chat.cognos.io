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

test('clicking the profile opens the Account page at /account (not Plan & billing)', async ({
  page,
}) => {
  const fixture = buildVaultFixture('user_e2e_acct01', 'acct@example.com');
  await seed(page, fixture);

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');

  // The sidebar profile row links to the account home.
  await page.getByRole('link', { name: 'Account & billing' }).click();

  await expect(page).toHaveURL(/\/account$/);
  await expect(
    page.getByRole('heading', { name: 'Account', exact: true }),
  ).toBeVisible();
  // It must NOT have redirected to Plan & billing.
  await expect(page.getByRole('heading', { name: 'Plan & billing' })).toHaveCount(0);

  // Plan & billing is still reachable from the settings nav.
  await page.getByRole('link', { name: 'Plan & billing' }).click();
  await expect(page).toHaveURL(/\/account\/billing$/);
  await expect(page.getByRole('heading', { name: 'Plan & billing' })).toBeVisible();
});
