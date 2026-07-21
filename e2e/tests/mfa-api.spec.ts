import { expect, test } from '@playwright/test';

import { newAnonymousApi, provisionApiUser } from './api-helpers';
import { enrolMfa, generateTotp, passwordLogin } from './mfa-helpers';

// End-to-end MFA contract against the real backend. These mirror the spec's P0
// test plan (docs/business_processes/mfa-login.md) at the HTTP boundary.

test.describe('MFA login interception', () => {
  test('non-enrolled user logs in normally (control)', async () => {
    const user = await provisionApiUser();
    const anon = await newAnonymousApi();

    const result = await passwordLogin(anon, user.account.email, user.account.password);
    expect(result.status).toBe(200);
    expect(result.hasToken).toBe(true);
  });

  test('enrolled user is challenged: no token, mfa_required + session id', async () => {
    const user = await provisionApiUser();
    await enrolMfa(user);

    const anon = await newAnonymousApi();
    const result = await passwordLogin(anon, user.account.email, user.account.password);

    expect(result.status).toBe(401);
    expect(result.hasToken).toBe(false);
    expect(result.mfaSessionId, 'a session id must be returned').toBeTruthy();
  });

  test('direct PocketBase auth-with-password cannot bypass MFA', async () => {
    // Same route the SDK uses — the interception is on PocketBase's own
    // endpoint, so hitting it directly is still challenged.
    const user = await provisionApiUser();
    await enrolMfa(user);

    const anon = await newAnonymousApi();
    const res = await anon.post('/api/collections/users/auth-with-password', {
      data: { identity: user.account.email, password: user.account.password },
    });
    expect(res.status()).toBe(401);
    expect(await res.text()).not.toContain('"token"');
  });
});

test.describe('MFA completion', () => {
  test('valid TOTP code completes login and returns a token', async () => {
    const user = await provisionApiUser();
    const { secret } = await enrolMfa(user);

    const anon = await newAnonymousApi();
    const challenge = await passwordLogin(
      anon,
      user.account.email,
      user.account.password,
    );
    expect(challenge.mfaSessionId).toBeTruthy();

    const res = await anon.post('/api/v1/auth/mfa/totp', {
      data: { mfaSessionId: challenge.mfaSessionId, code: generateTotp(secret) },
    });
    expect(res.status(), await res.text()).toBe(200);
    const body = (await res.json()) as { token: string; record: { id: string } };
    expect(body.token).toBeTruthy();
    expect(body.record.id).toBe(user.userId);
  });

  test('wrong TOTP code is rejected with no token', async () => {
    const user = await provisionApiUser();
    await enrolMfa(user);

    const anon = await newAnonymousApi();
    const challenge = await passwordLogin(
      anon,
      user.account.email,
      user.account.password,
    );

    const res = await anon.post('/api/v1/auth/mfa/totp', {
      data: { mfaSessionId: challenge.mfaSessionId, code: '000000' },
    });
    expect(res.status()).toBe(401);
    expect(await res.text()).not.toContain('"token"');
  });

  test('a recovery code completes login once and cannot be reused', async () => {
    const user = await provisionApiUser();
    const { recoveryCodes } = await enrolMfa(user);
    const code = recoveryCodes[0];

    const anon = await newAnonymousApi();

    // First use succeeds.
    const first = await passwordLogin(anon, user.account.email, user.account.password);
    const ok = await anon.post('/api/v1/auth/mfa/recovery', {
      data: { mfaSessionId: first.mfaSessionId, code },
    });
    expect(ok.status(), await ok.text()).toBe(200);

    // Second use of the same code fails.
    const second = await passwordLogin(anon, user.account.email, user.account.password);
    const reused = await anon.post('/api/v1/auth/mfa/recovery', {
      data: { mfaSessionId: second.mfaSessionId, code },
    });
    expect(reused.status()).toBe(401);
  });
});

test.describe('MFA refresh and trusted devices', () => {
  test('token refresh after MFA login is NOT re-challenged', async () => {
    const user = await provisionApiUser();
    const { secret } = await enrolMfa(user);

    const anon = await newAnonymousApi();
    const challenge = await passwordLogin(
      anon,
      user.account.email,
      user.account.password,
    );
    const completion = await anon.post('/api/v1/auth/mfa/totp', {
      data: { mfaSessionId: challenge.mfaSessionId, code: generateTotp(secret) },
    });
    const { token } = (await completion.json()) as { token: string };

    // authRefresh must succeed and return a token, not an mfa_required 401.
    const refresh = await anon.post('/api/collections/users/auth-refresh', {
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(refresh.status(), await refresh.text()).toBe(200);
    const refreshed = (await refresh.json()) as { token: string };
    expect(refreshed.token).toBeTruthy();
  });

  test('remembered device skips the TOTP step on the next sign-in', async () => {
    const user = await provisionApiUser();
    const { secret } = await enrolMfa(user);

    const anon = await newAnonymousApi();
    const challenge = await passwordLogin(
      anon,
      user.account.email,
      user.account.password,
    );
    const completion = await anon.post('/api/v1/auth/mfa/totp', {
      data: {
        mfaSessionId: challenge.mfaSessionId,
        code: generateTotp(secret),
        rememberDevice: true,
        deviceLabel: 'e2e device',
      },
    });
    expect(completion.status(), await completion.text()).toBe(200);
    const meta = (await completion.json()) as {
      meta?: { trustedDeviceToken?: string };
    };
    const deviceToken = meta.meta?.trustedDeviceToken;
    expect(deviceToken, 'a trusted-device token must be returned').toBeTruthy();

    // Next sign-in with the device token gets a token directly, no challenge.
    const remembered = await passwordLogin(
      anon,
      user.account.email,
      user.account.password,
      deviceToken,
    );
    expect(remembered.status).toBe(200);
    expect(remembered.hasToken).toBe(true);
    expect(remembered.mfaSessionId).toBeFalsy();
  });
});
