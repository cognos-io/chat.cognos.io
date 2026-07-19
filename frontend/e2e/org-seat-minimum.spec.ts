import { expect, test } from '@playwright/test';

import { buildVaultFixture, seedAuthenticatedUnlockState } from './fixtures';
import { expectNoRawI18nKeys } from './i18n-helpers';

const API = 'http://localhost:8090';

test('team create flow explains the three-seat minimum before checkout (sunny)', async ({
  page,
}) => {
  const userFixture = buildVaultFixture('user_org_seat_min', 'seat-min@example.com');

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
  await page.route(`${API}/api/v1/orgs`, async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: [] });
      return;
    }
    await route.continue();
  });

  await page.goto('/account/team');

  await expect(page.getByText(/minimum of 3 seats/i)).toBeVisible({ timeout: 15_000 });
  await expect(page.getByText(/CHF 45/i)).toBeVisible();
  await expectNoRawI18nKeys(page, 'team create (seat minimum copy)');
});

test('active org billing panel shows the three-seat minimum note (edge)', async ({
  page,
}) => {
  const userFixture = buildVaultFixture(
    'user_org_billing_min',
    'billing-min@example.com',
  );
  const orgId = 'org_e2e_seat_min';

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
  await page.route(`${API}/api/v1/orgs`, async (route) => {
    await route.fulfill({
      json: [
        {
          id: orgId,
          name: 'Minimum Seats Co',
          caller_role: 'owner',
          created: '2026-01-01T00:00:00.000Z',
          policy_privacy_tier: '',
          policy_retention_days: 0,
          policy_mfa_required: false,
        },
      ],
    });
  });
  await page.route(`${API}/api/v1/orgs/${orgId}/billing`, async (route) => {
    await route.fulfill({
      json: {
        plan_type: 'payg',
        past_due: false,
        seat_quantity: 3,
        pending_seat_quantity: 3,
        cycle_start_at: '2026-06-01T00:00:00.000Z',
        cycle_end_at: '2026-07-01T00:00:00.000Z',
        floor_rappen: 4500,
        pooled_usage_rappen: 0,
        projected_overage_rappen: 0,
      },
    });
  });
  await page.route(`${API}/api/v1/orgs/${orgId}/usage`, async (route) => {
    await route.fulfill({ json: { total_rappen: 0, members: [] } });
  });

  await page.route(`${API}/api/v1/orgs/${orgId}/members`, async (route) => {
    await route.fulfill({ json: [] });
  });

  await page.goto('/account/team');

  await expect(page.getByRole('button', { name: 'Billing & usage' })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole('button', { name: 'Billing & usage' }).click();

  await expect(page.getByText(/billed for at least 3 seats/i)).toBeVisible();
  await expect(
    page.locator('dt', { hasText: 'Floor' }).locator('..').getByText('CHF 45.00'),
  ).toBeVisible();
  await expectNoRawI18nKeys(page, 'org billing tab (seat minimum)');
});
