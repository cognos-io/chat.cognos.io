import { expect, test } from '@playwright/test';

import { buildVaultFixture, seedAuthenticatedUnlockState } from './fixtures';

const API = 'http://localhost:8090';

// Regression guard: the VaultService is an app-lifetime singleton and the SPA
// never reloads on logout → login. A bug let it keep the *previous* user's
// keyPairRecord in memory, so a different account on the same browser session
// was shown the previous user's "Unlock encrypted backup" prompt (which it
// could never satisfy) instead of its own flow. This drives the real
// logout → sign-in-as-a-different-user path and asserts the new account gets
// its own state.
test('a different account on the same session is not shown the previous user’s unlock prompt', async ({
  page,
}) => {
  const userA = buildVaultFixture('user_a_000000001', 'a@example.com');
  const userB = buildVaultFixture('user_b_000000002', 'b@example.com');

  // user A starts authenticated + trusted, so the app loads unlocked.
  await seedAuthenticatedUnlockState(page, userA);

  // The key-pair endpoint returns A's backup until user B signs in, then 404
  // (B is a brand-new account with no backup).
  let userBSignedIn = false;
  await page.route(`${API}/api/v1/user-key-pair`, async (route) => {
    if (userBSignedIn) {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Not found' }),
      });
      return;
    }
    await route.fulfill({ json: userA.userKeyPairRecord });
  });

  await page.route(`${API}/api/v1/vault-session`, async (route) => {
    if (route.request().method() === 'DELETE') {
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    await route.fulfill({ json: userA.vaultSession });
  });
  await page.route(`${API}/api/v1/user-preferences`, (route) =>
    route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Not found' }),
    }),
  );
  await page.route(`${API}/api/v1/conversations`, (route) =>
    route.fulfill({ json: [] }),
  );
  await page.route(`${API}/api/v1/models`, (route) =>
    route.fulfill({
      json: { privacy_tier: 'eu', preferred_model_id: 'm', models: [] },
    }),
  );
  await page.route(`${API}/api/v1/billing`, (route) =>
    route.fulfill({
      json: { plan_type: 'trial', status: 'trial', balance_chf: 2, trial_seed_chf: 2 },
    }),
  );
  await page.route(`${API}/api/v1/billing/usage`, (route) =>
    route.fulfill({
      json: { period_start: '2026-06-01T00:00:00Z', message_count: 0, by_model: [] },
    }),
  );

  // Logout endpoint + the init token refresh (always answers for user A; the
  // 5-minute repeat never fires within the test).
  await page.route(`${API}/v1/auth/logout`, (route) =>
    route.fulfill({ status: 204, body: '' }),
  );
  await page.route('**/api/collections/users/auth-refresh', (route) =>
    route.fulfill({
      json: { token: userA.authState.token, record: userA.authState.model },
    }),
  );

  // Sign-in as user B → from here the key-pair endpoint is 404.
  await page.route('**/api/collections/users/auth-with-password', async (route) => {
    userBSignedIn = true;
    await route.fulfill({
      json: { token: userB.authState.token, record: userB.authState.model },
    });
  });

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto('/');

  // user A is unlocked → chat shell, no unlock dialog.
  await expect(page.getByRole('button', { name: 'New chat' })).toBeVisible();

  // Log out from the sidebar.
  await page
    .locator('.cog-desktop-shell__nav')
    .getByRole('button', { name: 'Log out' })
    .click();
  await expect(page).toHaveURL(/\/auth\/login/);

  // Sign in as a *different* account.
  await page.locator('#email').fill('b@example.com');
  await page.locator('#password').fill('user-b-password');
  await page.getByRole('button', { name: 'Log in' }).click();

  // The fresh account has no backup → it must get the generate-key flow, and
  // must NOT see the previous user's "Unlock encrypted backup" prompt.
  await expect(page.getByRole('button', { name: 'Copy Account Key' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Unlock encrypted backup' }),
  ).toHaveCount(0);
});
