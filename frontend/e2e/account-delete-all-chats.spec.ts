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

test('the danger zone deletes all chats after a confirmation step', async ({
  page,
}) => {
  const fixture = buildVaultFixture('user_e2e_del01', 'delete@example.com');
  await seed(page, fixture);

  // The chat list starts with one conversation.
  await page.route(`${API}/api/v1/conversations`, (route) => {
    if (route.request().method() === 'GET') {
      return route.fulfill({
        json: [
          {
            id: 'conv0000000001',
            created: '2026-06-01T00:00:00Z',
            updated: '2026-06-01T00:00:00Z',
            data: 'e30=',
            creator: fixture.authState.model.id,
            key_version: 1,
          },
        ],
      });
    }
    return route.fallback();
  });

  let bulkDeleteCalled = false;
  await page.route(`${API}/api/v1/conversations`, (route) => {
    if (route.request().method() === 'DELETE') {
      bulkDeleteCalled = true;
      return route.fulfill({ json: { deleted: 3 } });
    }
    return route.fallback();
  });

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/account');

  // The destructive action requires an explicit confirmation step.
  await page.getByRole('button', { name: 'Delete all chats' }).click();
  await page.getByRole('button', { name: 'Yes, delete everything' }).click();

  await expect.poll(() => bulkDeleteCalled).toBe(true);
  await expect(page.getByText('Deleted 3 chats')).toBeVisible();
});
