import { APIRequestContext, Page, expect, request } from '@playwright/test';
import { randomBytes } from 'node:crypto';

import { POCKETBASE_URL } from './api-helpers';
import {
  encryptMessage,
  generateConversationSecret,
  generateKeyPair,
  sealFor,
  utf8,
} from './crypto-helpers';
import { TestAccount, makeTestAccount } from './fixtures';
import {
  acknowledgeAccountKey,
  captureGeneratedAccountKey,
  copyAccountKey,
  createEncryptedBackup,
  expectAccountKeyDialogForNewUser,
  fillRegisterForm,
  gotoRegister,
  submitRegister,
} from './helpers';

// Shared plumbing for the persona-walkthrough browser specs (Sophie PER-005 /
// Nils PER-006). The e2e stack has no Paddle, so org billing states are seeded
// directly into the locked `org_billing` collection via the e2e superuser —
// the same test-only superuser the rest of the suite already uses to mark
// emails verified (playwright.config.ts provisions it).

const API_CONTEXT_OPTIONS = {
  baseURL: POCKETBASE_URL,
  ignoreHTTPSErrors: true,
};

const SUPERUSER_EMAIL = process.env.E2E_SUPERUSER_EMAIL ?? 'e2e-superuser@example.com';
const SUPERUSER_PASSWORD =
  process.env.E2E_SUPERUSER_PASSWORD ?? 'e2e-superuser-password-1234'; // gitleaks:allow

async function superuserApi(): Promise<APIRequestContext> {
  const setup = await request.newContext(API_CONTEXT_OPTIONS);
  const authed = await setup.post('/api/collections/_superusers/auth-with-password', {
    data: { identity: SUPERUSER_EMAIL, password: SUPERUSER_PASSWORD },
  });
  expect(authed.ok(), `superuser auth: ${authed.status()} ${await authed.text()}`).toBe(
    true,
  );
  const { token } = (await authed.json()) as { token: string };
  await setup.dispose();
  return request.newContext({
    ...API_CONTEXT_OPTIONS,
    extraHTTPHeaders: { Authorization: `Bearer ${token}` },
  });
}

export interface AuthedApiUser {
  api: APIRequestContext;
  userId: string;
  token: string;
}

/** Create a structurally valid vault key record for an API-only persona. */
export async function createApiUserKeyPair(api: APIRequestContext): Promise<string> {
  const keyPair = generateKeyPair();
  const created = await api.post('/api/v1/user-key-pair', {
    data: {
      public_key: keyPair.publicKey,
      secret_key: randomBytes(64).toString('base64'),
      password_salt: randomBytes(16).toString('base64'),
      unlock_scheme: 'account_key_v2',
      record_mac: randomBytes(32).toString('base64'),
    },
  });
  expect(
    created.status(),
    `create API persona key pair: ${created.status()} ${await created.text()}`,
  ).toBe(201);
  return keyPair.publicKey;
}

/** Authenticate an EXISTING account over the API (e.g. one created in the browser). */
export async function apiLogin(account: TestAccount): Promise<AuthedApiUser> {
  const setup = await request.newContext(API_CONTEXT_OPTIONS);
  const authed = await setup.post('/api/collections/users/auth-with-password', {
    data: { identity: account.email, password: account.password },
  });
  expect(authed.ok(), `api login: ${authed.status()} ${await authed.text()}`).toBe(
    true,
  );
  const body = (await authed.json()) as { token: string; record: { id: string } };
  await setup.dispose();
  const api = await request.newContext({
    ...API_CONTEXT_OPTIONS,
    extraHTTPHeaders: { Authorization: `Bearer ${body.token}` },
  });
  return { api, userId: body.record.id, token: body.token };
}

export interface OrgBillingSeed {
  planType?: 'payg' | 'inactive';
  seats?: number;
  pastDue?: boolean;
}

/**
 * Upsert the org_billing record for an Organisation. Simulates what the
 * Paddle `subscription.activated` webhook would have written — the e2e stack
 * has no Paddle, and the collection rules are locked (superuser only).
 */
export async function upsertOrgBilling(
  orgId: string,
  seed: OrgBillingSeed = {},
): Promise<void> {
  const { planType = 'payg', seats = 1, pastDue = false } = seed;
  const su = await superuserApi();

  const now = Date.now();
  const day = 24 * 60 * 60 * 1000;
  const data = {
    organisation: orgId,
    plan_type: planType,
    paddle_customer_id: `ctm_e2e_${orgId}`,
    paddle_subscription_id: `sub_e2e_${orgId}`,
    paddle_price_id: 'pri_e2e_org_seat',
    paddle_cycle_start_at: new Date(now - 5 * day).toISOString(),
    paddle_cycle_end_at: new Date(now + 25 * day).toISOString(),
    seat_quantity: seats,
    pending_seat_quantity: seats,
    past_due: pastDue,
  };

  const listed = await su.get('/api/collections/org_billing/records', {
    params: { filter: `(organisation='${orgId}')`, perPage: 1 },
  });
  expect(listed.ok(), `list org_billing: ${listed.status()}`).toBe(true);
  const body = (await listed.json()) as { items: { id: string }[] };

  const saved =
    body.items.length === 1
      ? await su.patch(`/api/collections/org_billing/records/${body.items[0].id}`, {
          data,
        })
      : await su.post('/api/collections/org_billing/records', { data });
  expect(
    saved.ok(),
    `upsert org_billing: ${saved.status()} ${await saved.text()}`,
  ).toBe(true);

  await su.dispose();
}

/** Flip only the past_due flag (simulates a Paddle past_due webhook). */
export async function setOrgPastDue(orgId: string, pastDue: boolean): Promise<void> {
  const su = await superuserApi();
  const listed = await su.get('/api/collections/org_billing/records', {
    params: { filter: `(organisation='${orgId}')`, perPage: 1 },
  });
  const body = (await listed.json()) as { items: { id: string }[] };
  expect(body.items.length, 'org_billing row must exist before lapse').toBe(1);
  const patched = await su.patch(
    `/api/collections/org_billing/records/${body.items[0].id}`,
    { data: { past_due: pastDue } },
  );
  expect(patched.ok(), `set past_due: ${patched.status()}`).toBe(true);
  await su.dispose();
}

/** Read a user's REAL vault public key (written by the browser during setup). */
export async function userPublicKeyB64(userId: string): Promise<string> {
  const su = await superuserApi();
  const listed = await su.get('/api/collections/user_key_pairs/records', {
    params: { filter: `(user='${userId}')`, perPage: 1 },
  });
  expect(listed.ok(), `list user_key_pairs: ${listed.status()}`).toBe(true);
  const body = (await listed.json()) as { items: { public_key: string }[] };
  expect(body.items.length, `user ${userId} has no key pair`).toBe(1);
  await su.dispose();
  return body.items[0].public_key;
}

/**
 * Create an org-owned Project over the API with REAL crypto so the browser
 * session of `recipientPublicKeyB64`'s owner can decrypt and use it.
 *
 * Mirrors ProjectService.createProject byte-for-byte (secretbox data +
 * sealed-box wrapped key) and passes `organisation`. An optional second Admin
 * receives the same content key so offboarding the creator remains recoverable.
 */
export async function createOrgProjectViaApi(
  api: APIRequestContext,
  orgId: string,
  recipientPublicKeyB64: string,
  name: string,
  additionalAdmin?: { userId: string; publicKeyB64: string },
): Promise<string> {
  const contentKeyB64 = generateConversationSecret();
  const projectData = {
    version: '1',
    name,
    description: '',
    icon: 'folder',
    color: 'slate',
    instructions: '',
    defaultModelId: '',
  };
  const data = encryptMessage(contentKeyB64, utf8.encode(JSON.stringify(projectData)));
  const wrappedKey = sealFor(
    recipientPublicKeyB64,
    new Uint8Array(Buffer.from(contentKeyB64, 'base64')),
  );

  const res = await api.post('/api/v1/projects', {
    data: {
      data,
      wrapped_project_key: wrappedKey,
      organisation: orgId,
    },
  });
  expect(res.ok(), `create org project: ${res.status()} ${await res.text()}`).toBe(
    true,
  );
  const body = (await res.json()) as { id: string; organisation?: string };
  expect(body.organisation, 'project must be org-owned').toBe(orgId);

  if (additionalAdmin) {
    const adminWrappedKey = sealFor(
      additionalAdmin.publicKeyB64,
      new Uint8Array(Buffer.from(contentKeyB64, 'base64')),
    );
    const added = await api.post(`/api/v1/projects/${body.id}/participants`, {
      data: {
        user_id: additionalAdmin.userId,
        role: 'Admin',
        wrapped_project_key: adminWrappedKey,
      },
    });
    expect(
      added.status(),
      `add recovery Project Admin: ${added.status()} ${await added.text()}`,
    ).toBe(201);
  }

  return body.id;
}

/** Browser signup + vault setup, mirroring journeys.spec.ts. */
export async function provisionUnlockedAccount(
  page: Page,
): Promise<{ account: TestAccount; accountKey: string }> {
  const account = makeTestAccount();

  await gotoRegister(page);
  await fillRegisterForm(page, account);
  await submitRegister(page, account);

  await expectAccountKeyDialogForNewUser(page);

  const accountKey = await captureGeneratedAccountKey(page);
  await copyAccountKey(page);
  await acknowledgeAccountKey(page);
  await createEncryptedBackup(page);

  return { account, accountKey };
}

/**
 * DESIGN GATE: no raw i18n keys anywhere on the page. Raw keys look like
 * `team.billing.heading` / `workspace.personal` — dotted lowercase paths that
 * never occur in real English copy (a sentence-ending "workspace." is followed
 * by whitespace, so it does not match).
 */
export async function expectNoRawI18nKeys(page: Page, where: string): Promise<void> {
  const text = await page.locator('body').innerText();
  const matches =
    text.match(
      /\b(?:team|workspace|billing|chat|projects|common)\.[a-z][a-zA-Z]*(?:\.[a-zA-Z]+)+\b/g,
    ) ?? [];
  expect.soft(matches, `raw i18n keys visible on ${where}`).toEqual([]);
}

/** Sequential, self-describing screenshots under test-results/persona-<name>/. */
export function makeShooter(
  page: Page,
  persona: string,
): (name: string) => Promise<void> {
  let step = 0;
  return async (name: string) => {
    step += 1;
    await page.evaluate(async () => {
      await document.fonts.ready;
      await new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      });
    });
    await page.screenshot({
      path: `test-results/persona-${persona}/step-${String(step).padStart(2, '0')}-${name}.png`,
      fullPage: true,
      animations: 'disabled',
    });
  };
}

/** The composer textarea (same accessible name across the app). */
export function composer(page: Page) {
  return page.getByLabel(
    'Message Cognos — stored encrypted; sent to your provider to reply',
  );
}
