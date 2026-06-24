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

test('the Account page lets a user pick an avatar icon and colour', async ({
  page,
}) => {
  const fixture = buildVaultFixture('user_e2e_av01', 'avatar@example.com');
  await seed(page, fixture);

  let patched: Record<string, unknown> | undefined;
  await page.route(
    `${API}/api/collections/users/records/${fixture.authState.model.id}`,
    async (route) => {
      if (route.request().method() !== 'PATCH') {
        return route.fallback();
      }
      patched = JSON.parse(route.request().postData() ?? '{}');
      await route.fulfill({ json: { ...fixture.authState.model, ...patched } });
    },
  );

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/account');

  await page.getByRole('button', { name: 'Icon message-square' }).click();
  await page.getByRole('button', { name: 'Colour blue' }).click();
  await page.getByRole('button', { name: 'Save profile' }).click();

  await expect.poll(() => patched?.['avatar_icon']).toBe('message-square');
  expect(patched?.['avatar_color']).toBe('blue');
});

test('the Account page offers a transparent avatar colour', async ({ page }) => {
  const fixture = buildVaultFixture('user_e2e_av02', 'avatar2@example.com');
  await seed(page, fixture);

  let patched: Record<string, unknown> | undefined;
  await page.route(
    `${API}/api/collections/users/records/${fixture.authState.model.id}`,
    async (route) => {
      if (route.request().method() !== 'PATCH') {
        return route.fallback();
      }
      patched = JSON.parse(route.request().postData() ?? '{}');
      await route.fulfill({ json: { ...fixture.authState.model, ...patched } });
    },
  );

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/account');

  await page.getByRole('button', { name: 'Icon shield' }).click();
  await page.getByRole('button', { name: 'Colour transparent' }).click();
  await page.getByRole('button', { name: 'Save profile' }).click();

  await expect.poll(() => patched?.['avatar_color']).toBe('transparent');
});
