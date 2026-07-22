import { Page, expect, test } from '@playwright/test';
import { randomBytes } from 'node:crypto';

import { provisionApiUser } from './api-helpers';
import { fillLoginForm, gotoLogin, submitLogin } from './helpers';
import {
  apiLogin,
  createApiUserKeyPair,
  createOrgProjectViaApi,
  provisionUnlockedAccount,
  upsertOrgBilling,
  userPublicKeyB64,
} from './persona-helpers';

// Browser coverage for OP-001: Organisation Owners cannot delete their Account
// until they transfer/dissolve, and a member who deletes their Account must not
// take Organisation Projects with them.

function randomBase64(bytes: number): string {
  return randomBytes(bytes).toString('base64');
}

async function openDeleteAccountConfirm(page: Page): Promise<void> {
  await page.goto('/account');
  await expect(page.getByRole('heading', { name: /^account$/i })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByRole('button', { name: /^delete account$/i }).click();
  await expect(page.getByLabel('Type DELETE to confirm')).toBeVisible();
}

async function submitDeleteAccount(page: Page, password: string): Promise<void> {
  await page.getByLabel('Type DELETE to confirm').fill('DELETE');
  await page.getByLabel('Current password').fill(password);
  await page.getByRole('button', { name: /^delete my account$/i }).click();
}

test.describe('Account deletion + Organisation safety (browser)', () => {
  test('Organisation Owner sees a conflict toast and stays signed in', async ({
    page,
  }) => {
    test.setTimeout(120_000);

    const { account } = await provisionUnlockedAccount(page);
    const ownerApi = await apiLogin(account);

    try {
      const orgRes = await ownerApi.api.post('/api/v1/orgs', {
        data: { name: 'Browser Owner Block AG' },
      });
      expect(orgRes.status()).toBe(201);

      await openDeleteAccountConfirm(page);
      await submitDeleteAccount(page, account.password);

      await expect(
        page
          .locator('cog-toast-host')
          .getByText(
            /resolve billing or organisation ownership before deleting your account/i,
          ),
      ).toBeVisible({ timeout: 15_000 });

      // Still signed in on Account — deletion was refused.
      await expect(page).toHaveURL(/\/account/);
      await expect(
        page.getByRole('button', { name: /^delete my account$/i }),
      ).toBeVisible();
      expect((await ownerApi.api.get('/api/v1/billing')).status()).toBe(200);
    } finally {
      await ownerApi.api.dispose();
    }
  });

  test('member Account deletion keeps Organisation Projects for the Owner', async ({
    browser,
  }) => {
    test.setTimeout(180_000);

    const owner = await provisionApiUser();
    const memberPage = await browser.newPage();

    try {
      const { account: memberAccount } = await provisionUnlockedAccount(memberPage);
      const memberApi = await apiLogin(memberAccount);

      const orgRes = await owner.api.post('/api/v1/orgs', {
        data: { name: 'Browser Survive AG' },
      });
      expect(orgRes.status()).toBe(201);
      const { id: orgId } = (await orgRes.json()) as { id: string };
      await upsertOrgBilling(orgId, { planType: 'payg', seats: 3 });

      const inviteRes = await owner.api.post(`/api/v1/orgs/${orgId}/invites`, {
        data: { email: memberAccount.email, role: 'member' },
      });
      expect(inviteRes.ok()).toBe(true);
      const { token } = (await inviteRes.json()) as { token: string };
      const acceptRes = await memberApi.api.post('/api/v1/org-invites/accept', {
        data: { token },
      });
      expect(acceptRes.ok()).toBe(true);

      // API-only Owner needs a vault public key so they can be added as Admin.
      const ownerPublicKey = await createApiUserKeyPair(owner.api);
      const memberPublicKey = await userPublicKeyB64(memberApi.userId);

      // Member creates the org Project (creator = member). Owner is recovery Admin.
      const orgProjectId = await createOrgProjectViaApi(
        memberApi.api,
        orgId,
        memberPublicKey,
        'Member-created Project',
        { userId: owner.userId, publicKeyB64: ownerPublicKey },
      );

      const personalProjectRes = await memberApi.api.post('/api/v1/projects', {
        data: {
          data: randomBase64(48),
          wrapped_project_key: randomBase64(48),
        },
      });
      expect(personalProjectRes.status()).toBe(201);
      const { id: personalProjectId } = (await personalProjectRes.json()) as {
        id: string;
      };

      await openDeleteAccountConfirm(memberPage);
      await submitDeleteAccount(memberPage, memberAccount.password);

      await expect(
        memberPage
          .locator('cog-toast-host')
          .getByText(/your account has been deleted/i),
      ).toBeVisible({ timeout: 15_000 });

      // Session is cleared — Account settings require login again.
      await memberPage.goto('/account');
      await expect(memberPage).toHaveURL(/\/auth\/login/, { timeout: 15_000 });

      // Owner still has the Organisation Project; personal project is gone.
      expect((await owner.api.get(`/api/v1/projects/${orgProjectId}`)).status()).toBe(
        200,
      );
      expect(
        (await owner.api.get(`/api/v1/projects/${personalProjectId}`)).status(),
      ).toBe(404);

      // Deleted member cannot sign back in.
      await gotoLogin(memberPage);
      await fillLoginForm(memberPage, memberAccount);
      await submitLogin(memberPage);
      await expect(memberPage.getByRole('alert')).toContainText(
        /couldn't sign you in/i,
        { timeout: 15_000 },
      );

      await memberApi.api.dispose();
    } finally {
      await owner.api.dispose();
      await memberPage.close();
    }
  });
});
