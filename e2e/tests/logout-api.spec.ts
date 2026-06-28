import { expect, request, test } from '@playwright/test';
import { randomBytes } from 'node:crypto';

import { POCKETBASE_URL, newAnonymousApi, provisionApiUser } from './api-helpers';

// 32 bytes encoded → exactly 44 base64 chars (incl. one `=` pad).
// Vault-session handler hardcodes this length as a structural check.
function randomWrapKey(): string {
  return randomBytes(32).toString('base64');
}

test.describe('POST /v1/auth/logout contract', () => {
  test('auth gate: anonymous logout returns 401', async () => {
    const api = await newAnonymousApi();
    try {
      const res = await api.post('/v1/auth/logout');
      expect(res.status()).toBe(401);
    } finally {
      await api.dispose();
    }
  });

  test('happy path returns 204 NoContent', async () => {
    const user = await provisionApiUser();
    try {
      const res = await user.api.post('/v1/auth/logout');
      expect(res.status()).toBe(204);
      // 204 contract: no body. Reading text() is safe; assert it's empty so a
      // future regression that returns a payload (e.g. a leaked user record)
      // fails immediately.
      expect(await res.text()).toBe('');
    } finally {
      await user.api.dispose();
    }
  });

  test('refreshes the auth token so the prior session token stops authenticating', async () => {
    // PocketBase auth tokens are signed against the user's tokenKey. The
    // logout handler calls Auth.RefreshTokenKey() + app.Save() which
    // rotates that key, so a stolen pre-logout token must immediately
    // stop validating. This is the load-bearing security guarantee of the
    // endpoint — verify it directly rather than trusting the 204.
    const user = await provisionApiUser();
    try {
      // Sanity: token works before logout.
      const before = await user.api.get('/api/v1/conversations');
      expect(before.status()).toBe(200);

      const logout = await user.api.post('/v1/auth/logout');
      expect(logout.status()).toBe(204);

      // Same token, same request context — must now 401 because tokenKey
      // rotated server-side.
      const after = await user.api.get('/api/v1/conversations');
      expect(after.status()).toBe(401);
    } finally {
      await user.api.dispose();
    }
  });

  test('deletes the vault session as a side effect', async () => {
    // Logging out on one device should drop the server-held wrap key so
    // a re-login on the same device falls back to the password+account-key
    // unlock path rather than the trusted-device fast path. This is the
    // contract the frontend's logout() relies on — if the wrap key
    // survived logout, an attacker with browser access could still
    // unlock without prompting.
    const user = await provisionApiUser();
    try {
      const put = await user.api.put('/api/v1/vault-session', {
        data: { wrap_key: randomWrapKey() },
      });
      expect(put.status()).toBe(200);

      // Vault session is now present.
      const before = await user.api.get('/api/v1/vault-session');
      expect(before.status()).toBe(200);

      const logout = await user.api.post('/v1/auth/logout');
      expect(logout.status()).toBe(204);

      // Re-auth with the same credentials so we can confirm the vault
      // session row is gone (the prior token is dead — see the
      // refresh test above).
      const setup = await request.newContext({
        baseURL: POCKETBASE_URL,
        ignoreHTTPSErrors: true,
      });
      const reauth = await setup.post('/api/collections/users/auth-with-password', {
        data: { identity: user.account.email, password: user.account.password },
      });
      expect(reauth.status()).toBe(200);
      const reauthBody = (await reauth.json()) as { token: string };
      await setup.dispose();

      const refreshed = await request.newContext({
        baseURL: POCKETBASE_URL,
        ignoreHTTPSErrors: true,
        extraHTTPHeaders: { Authorization: `Bearer ${reauthBody.token}` },
      });
      try {
        const after = await refreshed.get('/api/v1/vault-session');
        expect(after.status()).toBe(404);
      } finally {
        await refreshed.dispose();
      }
    } finally {
      await user.api.dispose();
    }
  });

  test('tolerates no vault session present at logout time', async () => {
    // The handler only deletes the vault row if FindFirstRecordByData
    // returns one. Fresh users have no wrap key, and the handler should
    // still return 204 — not 500 — for them.
    const user = await provisionApiUser();
    try {
      // Confirm no vault session exists.
      const before = await user.api.get('/api/v1/vault-session');
      expect(before.status()).toBe(404);

      const logout = await user.api.post('/v1/auth/logout');
      expect(logout.status()).toBe(204);
    } finally {
      await user.api.dispose();
    }
  });
});
