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

test('delete account requires typing DELETE then logs out', async ({ page }) => {
  const fixture = buildVaultFixture('user_e2e_acctdel1', 'acctdel@example.com');
  await seed(page, fixture);

  let deleteCalled = false;
  await page.route(`${API}/api/v1/account`, async (route) => {
    expect(route.request().postDataJSON()).toEqual({
      password: 'current-password',
      totpCode: '',
    });
    deleteCalled = true;
    await route.fulfill({ status: 204, body: '' });
  });
  await page.route(`${API}/v1/auth/logout`, (r) =>
    r.fulfill({ status: 204, body: '' }),
  );

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/account');

  await page.getByRole('button', { name: 'Delete account' }).click();

  // Both the explicit phrase and current password are required.
  const confirm = page.getByRole('button', { name: 'Delete my account' });
  await expect(confirm).toBeDisabled();
  await page.getByLabel('Type DELETE to confirm').fill('DELETE');
  await expect(confirm).toBeDisabled();
  await page.getByLabel('Current password').fill('current-password');
  await expect(confirm).toBeEnabled();
  await confirm.click();

  await expect.poll(() => deleteCalled).toBe(true);
  await expect(page).toHaveURL(/\/auth\/login$/);
});

test('delete account surfaces the active-plan block', async ({ page }) => {
  const fixture = buildVaultFixture('user_e2e_acctdel2', 'acctdel2@example.com');
  await seed(page, fixture);

  await page.route(`${API}/api/v1/account`, async (route) => {
    await route.fulfill({
      status: 409,
      contentType: 'application/json',
      body: JSON.stringify({
        message: 'Cancel your plan before deleting your account',
      }),
    });
  });

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/account');

  await page.getByRole('button', { name: 'Delete account' }).click();
  await page.getByLabel('Type DELETE to confirm').fill('DELETE');
  await page.getByLabel('Current password').fill('current-password');
  await page.getByRole('button', { name: 'Delete my account' }).click();

  await expect(
    page.getByText('Cancel your plan before deleting your account'),
  ).toBeVisible();
  // Still on the account page — deletion was refused.
  await expect(page).toHaveURL(/\/account$/);
});
