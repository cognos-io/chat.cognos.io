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

test('account language card switches the UI and persists to the user record', async ({
  page,
}) => {
  const fixture = buildVaultFixture('user_e2e_lang01', 'lang@example.com');
  await seed(page, fixture);

  // Capture the PATCH that persists the language onto the user's own record.
  let savedLanguage: string | null = null;
  await page.route(
    `${API}/api/collections/users/records/${fixture.authState.model.id}`,
    async (route) => {
      const body = route.request().postDataJSON() as { preferred_language?: string };
      savedLanguage = body?.preferred_language ?? null;
      await route.fulfill({
        json: { ...fixture.authState.model, preferred_language: savedLanguage },
      });
    },
  );

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/account');

  // Defaults to English.
  await expect(
    page.getByRole('heading', { name: 'Account', exact: true }),
  ).toBeVisible();

  // Switch to German via the in-page Language card.
  await page.getByRole('button', { name: 'Language', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Deutsch' }).click();

  // The page localises and the choice is saved to the account.
  await expect(page.getByRole('heading', { name: 'Konto', exact: true })).toBeVisible();
  await expect(
    page.getByRole('heading', { name: 'Profil', exact: true }),
  ).toBeVisible();
  await expect.poll(() => savedLanguage).toBe('de');
});
