import { Page, expect, test } from '@playwright/test';

// Two real users sharing one device/browser session. Each registers (the
// browser generates their Account Key and encrypts their backup with the real
// argon2 KDF — no crypto is faked here), then later signs in fresh and unlocks
// their OWN backup with their OWN Account Key. This proves the singleton
// VaultService rebinds to whoever is signed in: after a user switch with no page
// reload, each user decrypts their own backup and never inherits the other's
// vault state. The backend is mocked but only stores/replays the key-pair
// records the browser produces.

const API = 'http://localhost:8090';

// A short-lived JWT-shaped token so PocketBase's authStore treats it as valid.
const tokenFor = (id: string): string => {
  const seg = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${seg({ alg: 'HS256', typ: 'JWT' })}.${seg({
    exp: Math.floor(Date.now() / 1000) + 3600,
    sub: id,
  })}.sig`;
};

interface MockState {
  usersByEmail: Record<string, string>; // email -> user id
  keyPairs: Record<string, unknown>; // user id -> stored key-pair record
  currentUserId: string | null;
}

const installRoutes = async (page: Page, state: MockState) => {
  const idFor = (email: string) => {
    if (!state.usersByEmail[email]) {
      state.usersByEmail[email] =
        'user_' +
        email
          .replace(/[^a-z0-9]/gi, '')
          .slice(0, 10)
          .padEnd(10, '0');
    }
    return state.usersByEmail[email];
  };
  const recordFor = (id: string, email: string) => ({
    id,
    email,
    collectionId: '_pb_users_auth_',
    collectionName: 'users',
    verified: true,
  });

  // --- PocketBase auth collection ---
  await page.route('**/api/collections/users/auth-methods', (route) =>
    route.fulfill({ json: { password: { enabled: true, identityFields: ['email'] } } }),
  );
  await page.route('**/api/collections/users/records', async (route) => {
    // Register: create user.
    const body = JSON.parse(route.request().postData() || '{}');
    const id = idFor(body.email);
    await route.fulfill({ json: recordFor(id, body.email) });
  });
  await page.route('**/api/collections/users/auth-with-password', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    const email = body.identity || body.email;
    const id = idFor(email);
    state.currentUserId = id;
    await route.fulfill({
      json: { token: tokenFor(id), record: recordFor(id, email) },
    });
  });
  await page.route('**/api/collections/users/auth-refresh', async (route) => {
    const id = state.currentUserId ?? 'unknown';
    await route.fulfill({ json: { token: tokenFor(id), record: recordFor(id, '') } });
  });
  await page.route(`${API}/v1/auth/logout`, (route) =>
    route.fulfill({ status: 204, body: '' }),
  );

  // --- Vault key-pair store (the records the browser creates) ---
  await page.route(`${API}/api/v1/user-key-pair`, async (route) => {
    const id = state.currentUserId;
    if (route.request().method() === 'POST') {
      const record = JSON.parse(route.request().postData() || '{}');
      const stored = {
        ...record,
        id: 'ukp_' + id,
        user: id,
        collectionId: 'user_key_pairs',
        collectionName: 'user_key_pairs',
        created: '2026-06-15T00:00:00Z',
        updated: '2026-06-15T00:00:00Z',
      };
      if (id) state.keyPairs[id] = stored;
      await route.fulfill({ json: stored });
      return;
    }
    if (id && state.keyPairs[id]) {
      await route.fulfill({ json: state.keyPairs[id] });
      return;
    }
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Not found' }),
    });
  });

  // Trusted-session: PUT must succeed for registration; the local blob is wiped
  // on logout, so the next sign-in forces a real manual unlock.
  await page.route(`${API}/api/v1/vault-session`, async (route) => {
    const method = route.request().method();
    if (method === 'DELETE') {
      await route.fulfill({ status: 204, body: '' });
      return;
    }
    if (method === 'PUT') {
      const body = JSON.parse(route.request().postData() || '{}');
      await route.fulfill({ json: { wrap_key: body.wrap_key ?? '' } });
      return;
    }
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Not found' }),
    });
  });

  // --- Surrounding app data ---
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
};

// Register via the UI; the browser generates the Account Key and encrypts the
// backup. Returns the generated Account Key shown in the dialog.
const registerAndCaptureKey = async (
  page: Page,
  email: string,
  password: string,
): Promise<string> => {
  await page.goto('/auth/register');
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  // Single-password signup — no confirmation field.
  await page.getByRole('button', { name: 'Create account' }).click();

  // The new-key dialog shows the generated Account Key.
  const keyEl = page.locator('.vault-password-dialog__account-key-value');
  await expect(keyEl).toBeVisible();
  const accountKey = ((await keyEl.textContent()) ?? '').trim();
  expect(accountKey.replace(/[^A-Za-z0-9]/g, '').length).toBe(32);

  // v2 backup creation: acknowledge the Account Key (no password), then create
  // the encrypted backup (browser runs argon2).
  await page
    .locator('.vault-password-dialog__checkbox-row input[type="checkbox"]')
    .check();
  await page.getByRole('button', { name: 'Create encrypted backup' }).click();

  // Backup created → unlocked → chat shell.
  await expect(page.getByRole('button', { name: 'New chat' })).toBeVisible({
    timeout: 30000,
  });
  return accountKey;
};

const logOut = async (page: Page) => {
  await page
    .locator('.cog-desktop-shell__nav')
    .getByRole('button', { name: 'Log out' })
    .click();
  await expect(page).toHaveURL(/\/auth\/login/);
};

// Sign in, then unlock the existing backup with the user's own Account Key
// (browser re-derives the key via argon2 and decrypts).
const loginAndUnlock = async (
  page: Page,
  email: string,
  password: string,
  accountKey: string,
) => {
  await page.locator('#email').fill(email);
  await page.locator('#password').fill(password);
  await page.getByRole('button', { name: 'Log in' }).click();

  // Existing backup → unlock flow (never the other user's, never "new key").
  await expect(
    page.getByRole('button', { name: 'Unlock encrypted backup' }),
  ).toBeVisible();
  // v2 unlock asks for the Account Key alone — no password field.
  // The Account Key input is readonly until focused (anti-autofill), so click to
  // make it editable before filling.
  await page.locator('#account-key').click();
  await page.locator('#account-key').fill(accountKey);
  await page.getByRole('button', { name: 'Unlock encrypted backup' }).click();

  await expect(page.getByRole('button', { name: 'New chat' })).toBeVisible({
    timeout: 30000,
  });
};

test('two users on one device each unlock their own backup after switching', async ({
  page,
}) => {
  test.setTimeout(120000); // argon2 KDF runs several times in-browser

  const state: MockState = { usersByEmail: {}, keyPairs: {}, currentUserId: null };
  await installRoutes(page, state);
  await page.setViewportSize({ width: 1280, height: 800 });

  const pwA = 'user-a-password-1';
  const pwB = 'user-b-password-2';

  // Both users register on this device (browser creates each backup).
  const keyA = await registerAndCaptureKey(page, 'a@example.com', pwA);
  await logOut(page);
  const keyB = await registerAndCaptureKey(page, 'b@example.com', pwB);
  await logOut(page);

  // Keys are distinct, and both backups are stored.
  expect(keyA).not.toBe(keyB);

  // User A returns and unlocks THEIR OWN backup — even though B was the last
  // user fetched (the regression would have left B's record in memory).
  await loginAndUnlock(page, 'a@example.com', pwA, keyA);
  await logOut(page);

  // User B then unlocks their own backup on the same session.
  await loginAndUnlock(page, 'b@example.com', pwB, keyB);
});
