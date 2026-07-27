import { APIRequestContext, expect, request, test } from '@playwright/test';

import {
  POCKETBASE_URL,
  ProvisionedApiUser,
  newAnonymousApi,
  provisionApiUser,
} from './api-helpers';

const API_CONTEXT_OPTIONS = {
  baseURL: POCKETBASE_URL,
  ignoreHTTPSErrors: true,
};

const SUPERUSER_EMAIL = process.env.E2E_SUPERUSER_EMAIL ?? 'e2e-superuser@example.com';
const SUPERUSER_PASSWORD =
  process.env.E2E_SUPERUSER_PASSWORD ?? 'e2e-superuser-password-1234'; // gitleaks:allow
const INCORRECT_PASSWORD = 'definitely-not-the-password';
const UNUSED_PASSWORD = 'irrelevant';

async function superuserToken(setup: APIRequestContext): Promise<string> {
  const res = await setup.post('/api/collections/_superusers/auth-with-password', {
    data: { identity: SUPERUSER_EMAIL, password: SUPERUSER_PASSWORD },
  });
  expect(res.ok(), `superuser auth: ${res.status()} ${await res.text()}`).toBe(true);
  return ((await res.json()) as { token: string }).token;
}

/** Mark a provisioned user as OAuth-only (no Cognos password + Google external auth). */
async function markUserOAuthOnly(user: ProvisionedApiUser): Promise<void> {
  const setup = await request.newContext(API_CONTEXT_OPTIONS);
  const token = await superuserToken(setup);
  const headers = { Authorization: `Bearer ${token}` };

  const patched = await setup.patch(`/api/collections/users/records/${user.userId}`, {
    data: { has_cognos_password: false },
    headers,
  });
  expect(
    patched.ok(),
    `mark oauth-only: ${patched.status()} ${await patched.text()}`,
  ).toBe(true);

  const usersCol = await setup.get('/api/collections/users', { headers });
  expect(usersCol.ok()).toBe(true);
  const usersMeta = (await usersCol.json()) as { id: string };

  const created = await setup.post('/api/collections/_externalAuths/records', {
    data: {
      collectionRef: usersMeta.id,
      recordRef: user.userId,
      provider: 'google',
      providerId: `e2e-google-${user.userId}`,
    },
    headers,
  });
  expect(
    created.ok(),
    `create external auth: ${created.status()} ${await created.text()}`,
  ).toBe(true);

  await setup.dispose();
}

test.describe('Account auth-methods', () => {
  test('password Account reports hasPassword true and empty providers', async () => {
    const user = await provisionApiUser();
    const res = await user.api.get('/api/v1/account/auth-methods');
    expect(res.status(), await res.text()).toBe(200);
    const body = (await res.json()) as { hasPassword: boolean; providers: string[] };
    expect(body.hasPassword).toBe(true);
    expect(body.providers).toEqual([]);
  });

  test('anonymous caller is rejected', async () => {
    const anon = await newAnonymousApi();
    const res = await anon.get('/api/v1/account/auth-methods');
    expect(res.status()).toBe(401);
  });

  test('OAuth-only Account reports hasPassword false and google provider', async () => {
    const user = await provisionApiUser();
    await markUserOAuthOnly(user);

    const res = await user.api.get('/api/v1/account/auth-methods');
    expect(res.status(), await res.text()).toBe(200);
    const body = (await res.json()) as { hasPassword: boolean; providers: string[] };
    expect(body.hasPassword).toBe(false);
    expect(body.providers).toContain('google');
  });
});

test.describe('OAuth link intent', () => {
  test('wrong password is rejected', async () => {
    const user = await provisionApiUser();
    const res = await user.api.post('/api/v1/account/oauth/link-intent', {
      data: { password: INCORRECT_PASSWORD, provider: 'google' },
    });
    expect(res.status()).toBe(400);
    expect(await res.text()).toMatch(/Incorrect password/i);
  });

  test('correct password returns a one-time linkIntentId', async () => {
    const user = await provisionApiUser();
    const res = await user.api.post('/api/v1/account/oauth/link-intent', {
      data: { password: user.account.password, provider: 'google' },
    });
    expect(res.status(), await res.text()).toBe(200);
    const body = (await res.json()) as { linkIntentId: string };
    expect(body.linkIntentId.length).toBeGreaterThan(20);
  });
});

test.describe('OAuth delete step-up', () => {
  test('password Account cannot begin Google step-up', async () => {
    const user = await provisionApiUser();
    const res = await user.api.post('/api/v1/account/oauth/step-up/begin');
    expect(res.status()).toBe(400);
    expect(await res.text()).toMatch(/password/i);
  });

  test('OAuth-only Account rejects delete without oauthStepUpId', async () => {
    const user = await provisionApiUser();
    await markUserOAuthOnly(user);

    const res = await user.api.delete('/api/v1/account', {
      data: { password: UNUSED_PASSWORD },
    });
    expect(res.status()).toBe(400);
    expect(await res.text()).toMatch(/Google re-authentication required/i);
  });

  test('OAuth-only Account can begin step-up challenge', async () => {
    const user = await provisionApiUser();
    await markUserOAuthOnly(user);

    const res = await user.api.post('/api/v1/account/oauth/step-up/begin');
    expect(res.status(), await res.text()).toBe(200);
    const body = (await res.json()) as { challengeId: string };
    expect(body.challengeId.length).toBeGreaterThan(20);

    // Completing without Google confirm must fail.
    const complete = await user.api.post('/api/v1/account/oauth/step-up/complete', {
      data: { challengeId: body.challengeId },
    });
    expect(complete.status()).toBe(400);
  });
});
