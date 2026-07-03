import { APIRequestContext, expect, request } from '@playwright/test';

import { TestAccount, makeTestAccount } from './fixtures';

export const POCKETBASE_URL =
  process.env.E2E_POCKETBASE_URL ?? 'https://cognos.local:8095';

const API_CONTEXT_OPTIONS = {
  baseURL: POCKETBASE_URL,
  ignoreHTTPSErrors: true,
};

// E2E-only superuser provisioned by playwright.config.ts before the backend
// serves. Used to flip `verified` on freshly-registered users, since the AI
// endpoints require a verified email and the e2e stack has no SMTP.
const SUPERUSER_EMAIL = process.env.E2E_SUPERUSER_EMAIL ?? 'e2e-superuser@example.com';
const SUPERUSER_PASSWORD =
  process.env.E2E_SUPERUSER_PASSWORD ?? 'e2e-superuser-password-1234'; // gitleaks:allow

export interface ProvisionedApiUser {
  account: TestAccount;
  userId: string;
  token: string;
  api: APIRequestContext;
}

export interface ProvisionApiUserOptions {
  /**
   * Marks the user's email as verified (default). The AI-consuming endpoints
   * (completions, image generation, compaction) 403 with EMAIL_NOT_VERIFIED
   * otherwise. Pass `false` to exercise the unverified state.
   */
  verified?: boolean;
}

async function superuserToken(setup: APIRequestContext): Promise<string> {
  const superAuthed = await setup.post(
    '/api/collections/_superusers/auth-with-password',
    { data: { identity: SUPERUSER_EMAIL, password: SUPERUSER_PASSWORD } },
  );
  expect(
    superAuthed.ok(),
    `superuser auth: ${superAuthed.status()} ${await superAuthed.text()}`,
  ).toBe(true);
  return ((await superAuthed.json()) as { token: string }).token;
}

/**
 * Mark an existing user's email as verified via the e2e superuser. Exposed so
 * specs can verify a user mid-test (simulating the user clicking the
 * verification link).
 */
export async function markUserVerified(userId: string): Promise<void> {
  const setup = await request.newContext(API_CONTEXT_OPTIONS);
  const superToken = await superuserToken(setup);

  const patched = await setup.patch(`/api/collections/users/records/${userId}`, {
    data: { verified: true },
    headers: { Authorization: `Bearer ${superToken}` },
  });
  expect(
    patched.ok(),
    `mark verified: ${patched.status()} ${await patched.text()}`,
  ).toBe(true);

  await setup.dispose();
}

/**
 * Look a user up by email (as the e2e superuser) and mark them verified.
 * Used by the browser flows right after UI registration — the record id isn't
 * surfaced to the page, and the freshly-registered record can lag the click by
 * a moment, so this polls briefly.
 */
export async function markUserVerifiedByEmail(email: string): Promise<void> {
  const setup = await request.newContext(API_CONTEXT_OPTIONS);
  const superToken = await superuserToken(setup);
  const headers = { Authorization: `Bearer ${superToken}` };

  let userId = '';
  let lastResult = '';
  const deadline = Date.now() + 10_000;
  for (;;) {
    const listed = await setup.get('/api/collections/users/records', {
      params: { filter: `(email='${email}')`, perPage: 1 },
      headers,
    });
    if (listed.ok()) {
      const body = (await listed.json()) as { items: { id: string }[] };
      if (body.items.length === 1) {
        userId = body.items[0].id;
        break;
      }
      lastResult = `200 with ${body.items.length} matching users`;
    } else {
      lastResult = `${listed.status()} ${await listed.text()}`;
    }
    if (Date.now() > deadline) {
      throw new Error(
        `user ${email} not found to mark verified (last response: ${lastResult})`,
      );
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }

  const patched = await setup.patch(`/api/collections/users/records/${userId}`, {
    data: { verified: true },
    headers,
  });
  expect(
    patched.ok(),
    `mark verified: ${patched.status()} ${await patched.text()}`,
  ).toBe(true);

  await setup.dispose();
}

/**
 * Register a fresh PocketBase user and return an authenticated request
 * context. The participant / billing / models API surface doesn't require
 * the user's encryption material to be set up — the UI tests cover that
 * dance separately. Each call generates a unique email so concurrent runs
 * against the same PocketBase don't collide. Users are email-verified by
 * default (required for AI endpoints); pass `{ verified: false }` to keep
 * them unverified.
 */
export async function provisionApiUser(
  options: ProvisionApiUserOptions = {},
): Promise<ProvisionedApiUser> {
  const { verified = true } = options;
  const account = makeTestAccount();

  const setup = await request.newContext(API_CONTEXT_OPTIONS);

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

  if (verified) {
    await markUserVerified(createdBody.id);
  }

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
    ...API_CONTEXT_OPTIONS,
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
  return request.newContext(API_CONTEXT_OPTIONS);
}
