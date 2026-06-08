import { APIRequestContext, expect, request } from '@playwright/test';

import { TestAccount, makeTestAccount } from './fixtures';

export const POCKETBASE_URL = process.env.E2E_POCKETBASE_URL ?? 'http://localhost:8090';

export interface ProvisionedApiUser {
  account: TestAccount;
  userId: string;
  token: string;
  api: APIRequestContext;
}

/**
 * Register a fresh PocketBase user and return an authenticated request
 * context. The participant / billing / models API surface doesn't require
 * the user's encryption material to be set up — the UI tests cover that
 * dance separately. Each call generates a unique email so concurrent runs
 * against the same PocketBase don't collide.
 */
export async function provisionApiUser(): Promise<ProvisionedApiUser> {
  const account = makeTestAccount();

  const setup = await request.newContext({ baseURL: POCKETBASE_URL });

  const created = await setup.post('/api/collections/users/records', {
    data: {
      email: account.email,
      password: account.password,
      passwordConfirm: account.password,
    },
  });
  expect(created.ok(), `create user: ${created.status()} ${await created.text()}`).toBe(
    true,
  );
  const createdBody = (await created.json()) as { id: string };

  const authed = await setup.post('/api/collections/users/auth-with-password', {
    data: { identity: account.email, password: account.password },
  });
  expect(authed.ok(), `auth: ${authed.status()} ${await authed.text()}`).toBe(true);
  const authedBody = (await authed.json()) as {
    token: string;
    record: { id: string };
  };

  await setup.dispose();

  const api = await request.newContext({
    baseURL: POCKETBASE_URL,
    extraHTTPHeaders: { Authorization: `Bearer ${authedBody.token}` },
  });

  return {
    account,
    userId: authedBody.record?.id ?? createdBody.id,
    token: authedBody.token,
    api,
  };
}

/**
 * Build an unauthenticated request context against the PocketBase backend.
 * Useful for proving 401 contracts on protected endpoints without leaking a
 * test user's token into the request.
 */
export async function newAnonymousApi(): Promise<APIRequestContext> {
  return request.newContext({ baseURL: POCKETBASE_URL });
}
