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

test('the Account page lets a user set their display name', async ({ page }) => {
  const fixture = buildVaultFixture('user_e2e_prof01', 'profile@example.com');
  await seed(page, fixture);

  let patchedDisplayName: string | undefined;
  await page.route(
    `${API}/api/collections/users/records/${fixture.authState.model.id}`,
    async (route) => {
      if (route.request().method() !== 'PATCH') {
        return route.fallback();
      }
      const body = JSON.parse(route.request().postData() ?? '{}');
      patchedDisplayName = body.display_name;
      await route.fulfill({
        json: { ...fixture.authState.model, display_name: body.display_name },
      });
    },
  );

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/account');

  await expect(
    page.getByRole('heading', { name: 'Account', exact: true }),
  ).toBeVisible();

  await page.getByLabel('Display name').fill('Ada Lovelace');
  await page.getByRole('button', { name: 'Save profile' }).click();

  // The display name was sent to the backend and the sidebar reflects it.
  await expect.poll(() => patchedDisplayName).toBe('Ada Lovelace');
  await expect(page.getByText('Ada Lovelace').first()).toBeVisible();
});
