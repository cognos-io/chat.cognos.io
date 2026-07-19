import { expect, test } from '@playwright/test';

import {
  buildOrgWorkspaceFixture,
  buildVaultFixture,
  seedAuthenticatedUnlockState,
  seedOrgWorkspace,
} from './fixtures';
import { expectNoRawI18nKeys } from './i18n-helpers';

const API = 'http://localhost:8090';

const seedTeamShell = async (
  page: import('@playwright/test').Page,
  userFixture: ReturnType<typeof buildVaultFixture>,
) => {
  await page.route(`${API}/api/v1/user-key-pair`, async (route) => {
    await route.fulfill({ json: userFixture.userKeyPairRecord });
  });
  await page.route(`${API}/api/v1/vault-session`, async (route) => {
    await route.fulfill({ json: userFixture.vaultSession });
  });
  await page.route(`${API}/api/v1/user-preferences`, async (route) => {
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Not found' }),
    });
  });
};

test('link invite shows a shareable URL with instructions (sunny)', async ({
  page,
}) => {
  const userFixture = buildVaultFixture(
    'user_org_invite_link',
    'invite-link@example.com',
  );
  const orgFixture = buildOrgWorkspaceFixture(
    'org_e2e_invite_link',
    'Invite Link Co',
    userFixture.authState.model.id,
    'owner',
  );
  const inviteToken = 'a'.repeat(64);
  let pendingInvites: unknown[] = [];

  await seedAuthenticatedUnlockState(page, userFixture);
  await seedOrgWorkspace(page, userFixture.authState.model.id, orgFixture.orgId);
  await seedTeamShell(page, userFixture);

  await page.route(`${API}/api/v1/orgs`, async (route) => {
    await route.fulfill({ json: [orgFixture.orgRecord] });
  });
  await page.route(`${API}/api/v1/orgs/${orgFixture.orgId}/members`, async (route) => {
    await route.fulfill({ json: [] });
  });
  await page.route(`${API}/api/v1/orgs/${orgFixture.orgId}/invites`, async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: pendingInvites });
      return;
    }
    if (route.request().method() === 'POST') {
      pendingInvites = [
        {
          id: 'inv_e2e_link',
          invited_email: '',
          role: 'member',
          expires_at: '2026-08-01T00:00:00.000Z',
        },
      ];
      await route.fulfill({
        status: 201,
        json: {
          id: 'inv_e2e_link',
          invited_email: '',
          role: 'member',
          expires_at: '2026-08-01T00:00:00.000Z',
          token: inviteToken,
        },
      });
      return;
    }
    await route.continue();
  });

  await page.goto('/account/team?tab=invites');

  await expect(page.getByRole('heading', { name: 'Invite a team member' })).toBeVisible(
    {
      timeout: 15_000,
    },
  );
  await page.getByRole('button', { name: 'Create invite' }).click();

  await expect(page.getByText('Invite link created')).toBeVisible();
  await expect(
    page.getByText(
      'Send this link to your colleague. When they sign in (or create an Account) and open it, they join your Organisation.',
    ),
  ).toBeVisible();

  const linkField = page.getByRole('textbox', { name: 'Invite link' });
  const inviteLink = await linkField.inputValue();
  const origin = new URL(page.url()).origin;
  expect(inviteLink).toBe(`${origin}/invite?token=${encodeURIComponent(inviteToken)}`);

  await expectNoRawI18nKeys(page, 'invites tab (link created)');
});

test('copy copies the full invite link (edge)', async ({ page, context }) => {
  const userFixture = buildVaultFixture(
    'user_org_invite_copy',
    'invite-copy@example.com',
  );
  const orgFixture = buildOrgWorkspaceFixture(
    'org_e2e_invite_copy',
    'Copy Link Co',
    userFixture.authState.model.id,
    'admin',
  );
  const inviteToken = 'b'.repeat(64);

  await seedAuthenticatedUnlockState(page, userFixture);
  await seedOrgWorkspace(page, userFixture.authState.model.id, orgFixture.orgId);
  await seedTeamShell(page, userFixture);

  await page.route(`${API}/api/v1/orgs`, async (route) => {
    await route.fulfill({ json: [orgFixture.orgRecord] });
  });
  await page.route(`${API}/api/v1/orgs/${orgFixture.orgId}/members`, async (route) => {
    await route.fulfill({ json: [] });
  });
  await page.route(`${API}/api/v1/orgs/${orgFixture.orgId}/invites`, async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: [] });
      return;
    }
    await route.fulfill({
      status: 201,
      json: {
        id: 'inv_e2e_copy',
        invited_email: 'peer@example.com',
        role: 'member',
        expires_at: '2026-08-01T00:00:00.000Z',
        token: inviteToken,
      },
    });
  });

  await page.goto('/account/team?tab=invites');
  await expect(page.getByRole('button', { name: 'Create invite' })).toBeVisible({
    timeout: 15_000,
  });
  await page.getByLabel('Email address').fill('peer@example.com');
  await page.getByRole('button', { name: 'Create invite' }).click();

  const inviteLink = await page
    .getByRole('textbox', { name: 'Invite link' })
    .inputValue();

  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.getByRole('button', { name: 'Copy', exact: true }).click();
  await expect(page.getByText('Link copied to clipboard')).toBeVisible();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toBe(inviteLink);
});

test('dismiss hides the invite link and returns the create form (behaviour)', async ({
  page,
}) => {
  const userFixture = buildVaultFixture(
    'user_org_invite_done',
    'invite-done@example.com',
  );
  const orgFixture = buildOrgWorkspaceFixture(
    'org_e2e_invite_done',
    'Done Link Co',
    userFixture.authState.model.id,
    'owner',
  );

  await seedAuthenticatedUnlockState(page, userFixture);
  await seedOrgWorkspace(page, userFixture.authState.model.id, orgFixture.orgId);
  await seedTeamShell(page, userFixture);

  await page.route(`${API}/api/v1/orgs`, async (route) => {
    await route.fulfill({ json: [orgFixture.orgRecord] });
  });
  await page.route(`${API}/api/v1/orgs/${orgFixture.orgId}/members`, async (route) => {
    await route.fulfill({ json: [] });
  });
  await page.route(`${API}/api/v1/orgs/${orgFixture.orgId}/invites`, async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: [] });
      return;
    }
    await route.fulfill({
      status: 201,
      json: {
        id: 'inv_e2e_done',
        invited_email: '',
        role: 'member',
        expires_at: '2026-08-01T00:00:00.000Z',
        token: 'c'.repeat(64),
      },
    });
  });

  await page.goto('/account/team?tab=invites');
  await page.getByRole('button', { name: 'Create invite' }).click();
  await expect(page.getByRole('textbox', { name: 'Invite link' })).toBeVisible({
    timeout: 15_000,
  });

  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await expect(page.getByText('Invite link created')).toBeHidden();
  await expect(page.getByLabel('Email address')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create invite' })).toBeVisible();
});

test('create invite failure keeps the form without a link panel (rainy)', async ({
  page,
}) => {
  const userFixture = buildVaultFixture(
    'user_org_invite_fail',
    'invite-fail@example.com',
  );
  const orgFixture = buildOrgWorkspaceFixture(
    'org_e2e_invite_fail',
    'Fail Link Co',
    userFixture.authState.model.id,
    'owner',
  );

  await seedAuthenticatedUnlockState(page, userFixture);
  await seedOrgWorkspace(page, userFixture.authState.model.id, orgFixture.orgId);
  await seedTeamShell(page, userFixture);

  await page.route(`${API}/api/v1/orgs`, async (route) => {
    await route.fulfill({ json: [orgFixture.orgRecord] });
  });
  await page.route(`${API}/api/v1/orgs/${orgFixture.orgId}/members`, async (route) => {
    await route.fulfill({ json: [] });
  });
  await page.route(`${API}/api/v1/orgs/${orgFixture.orgId}/invites`, async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: [] });
      return;
    }
    await route.fulfill({
      status: 500,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'boom' }),
    });
  });

  await page.goto('/account/team?tab=invites');
  await page.getByRole('button', { name: 'Create invite' }).click();

  await expect(
    page.getByText('Could not create the invite. Please try again.'),
  ).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole('textbox', { name: 'Invite link' })).toHaveCount(0);
});
