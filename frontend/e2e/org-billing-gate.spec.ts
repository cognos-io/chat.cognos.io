import { expect, test } from '@playwright/test';

import {
  buildOrgWorkspaceFixture,
  buildVaultFixture,
  seedAuthenticatedUnlockState,
  seedOrgWorkspace,
} from './fixtures';
import { expectNoRawI18nKeys } from './i18n-helpers';

const API = 'http://localhost:8090';

const seedProjectsShell = async (
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
  await page.route(`${API}/api/v1/conversations`, async (route) => {
    await route.fulfill({ json: [] });
  });
  await page.route(`${API}/api/v1/personas`, async (route) => {
    await route.fulfill({ json: { items: [] } });
  });
  await page.route(`${API}/api/v1/billing`, async (route) => {
    await route.fulfill({
      json: { plan_type: 'trial', status: 'trial', balance_chf: 2, trial_seed_chf: 2 },
    });
  });
  await page.route(`${API}/api/v1/projects`, async (route) => {
    if (route.request().method() === 'POST') {
      await route.fulfill({
        status: 402,
        contentType: 'application/json',
        body: JSON.stringify({
          status: 402,
          message: 'Acme billing is paused.',
          data: {
            error: 'ORG_BILLING_INACTIVE',
            organisation_id: 'org_e2e_gate',
            organisation_name: 'Acme E2E',
            admin_message: 'Add a payment method to reactivate Acme E2E.',
          },
        }),
      });
      return;
    }
    await route.fulfill({ json: [] });
  });
  await page.route(`${API}/api/v1/projects/*/conversations`, async (route) => {
    await route.fulfill({ json: [] });
  });
};

test('owner in an org workspace sees billing callout and cannot create a project while inactive', async ({
  page,
}) => {
  const userFixture = buildVaultFixture(
    'user_org_gate_owner',
    'owner-gate@example.com',
  );
  const orgFixture = buildOrgWorkspaceFixture(
    'org_e2e_gate',
    'Acme E2E',
    userFixture.authState.model.id,
    'owner',
  );

  await seedAuthenticatedUnlockState(page, userFixture);
  await seedOrgWorkspace(page, userFixture.authState.model.id, orgFixture.orgId);
  await seedProjectsShell(page, userFixture);

  await page.route(`${API}/api/v1/orgs`, async (route) => {
    await route.fulfill({ json: [orgFixture.orgRecord] });
  });
  await page.route(`${API}/api/v1/orgs/${orgFixture.orgId}/billing`, async (route) => {
    await route.fulfill({ json: orgFixture.inactiveBilling });
  });

  await page.goto('/account/projects');

  await expect(page.getByText('Acme E2E billing is paused')).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole('button', { name: 'Open team billing' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create project' })).toBeDisabled();
  await expect(page.getByLabel('Project name')).toBeDisabled();
  await expect(page.getByRole('button', { name: 'Creating…' })).toHaveCount(0);
  await expectNoRawI18nKeys(page, 'projects page (owner inactive billing)');
});

test('owner sees past-due billing copy and a disabled create form (rainy)', async ({
  page,
}) => {
  const userFixture = buildVaultFixture(
    'user_org_gate_past_due',
    'pastdue@example.com',
  );
  const orgFixture = buildOrgWorkspaceFixture(
    'org_e2e_past_due',
    'Past Due Co',
    userFixture.authState.model.id,
    'owner',
  );

  await seedAuthenticatedUnlockState(page, userFixture);
  await seedOrgWorkspace(page, userFixture.authState.model.id, orgFixture.orgId);
  await seedProjectsShell(page, userFixture);

  await page.route(`${API}/api/v1/orgs`, async (route) => {
    await route.fulfill({ json: [orgFixture.orgRecord] });
  });
  await page.route(`${API}/api/v1/orgs/${orgFixture.orgId}/billing`, async (route) => {
    await route.fulfill({ json: orgFixture.pastDueBilling });
  });

  await page.goto('/account/projects');

  await expect(page.getByText('Past Due Co has a payment issue')).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole('button', { name: 'Open team billing' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Create project' })).toBeDisabled();
  await expectNoRawI18nKeys(page, 'projects page (owner past-due billing)');
});

test('sidebar empty org workspace shows billing guidance instead of create-project (edge)', async ({
  page,
}) => {
  const userFixture = buildVaultFixture(
    'user_org_gate_sidebar',
    'sidebar-gate@example.com',
  );
  const orgFixture = buildOrgWorkspaceFixture(
    'org_e2e_sidebar',
    'Sidebar Org',
    userFixture.authState.model.id,
    'owner',
  );

  await seedAuthenticatedUnlockState(page, userFixture);
  await seedOrgWorkspace(page, userFixture.authState.model.id, orgFixture.orgId);

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
  await page.route(`${API}/api/v1/conversations`, async (route) => {
    await route.fulfill({ json: [] });
  });
  await page.route(`${API}/api/v1/personas`, async (route) => {
    await route.fulfill({ json: { items: [] } });
  });
  await page.route(`${API}/api/v1/billing`, async (route) => {
    await route.fulfill({
      json: { plan_type: 'trial', status: 'trial', balance_chf: 2, trial_seed_chf: 2 },
    });
  });
  await page.route(`${API}/api/v1/models`, async (route) => {
    await route.fulfill({
      json: { privacy_tier: 'eu', preferred_model_id: '', models: [] },
    });
  });
  await page.route(`${API}/api/v1/projects`, async (route) => {
    await route.fulfill({ json: [] });
  });
  await page.route(`${API}/api/v1/orgs`, async (route) => {
    await route.fulfill({ json: [orgFixture.orgRecord] });
  });
  await page.route(`${API}/api/v1/orgs/${orgFixture.orgId}/billing`, async (route) => {
    await route.fulfill({ json: orgFixture.inactiveBilling });
  });

  await page.goto('/');

  await expect(page.getByText('Sidebar Org billing is paused')).toBeVisible({
    timeout: 15_000,
  });
  await expect(page.getByRole('link', { name: 'Create a project' })).toHaveCount(0);
  await expectNoRawI18nKeys(page, 'sidebar empty org workspace');
});

test('member sees org billing guidance without the owner checkout action when create is blocked reactively', async ({
  page,
}) => {
  const userFixture = buildVaultFixture(
    'user_org_gate_member',
    'member-gate@example.com',
  );
  const orgFixture = buildOrgWorkspaceFixture(
    'org_e2e_gate',
    'Acme E2E',
    userFixture.authState.model.id,
    'member',
  );

  await seedAuthenticatedUnlockState(page, userFixture);
  await seedOrgWorkspace(page, userFixture.authState.model.id, orgFixture.orgId);
  await seedProjectsShell(page, userFixture);

  await page.route(`${API}/api/v1/orgs`, async (route) => {
    await route.fulfill({ json: [orgFixture.orgRecord] });
  });
  await page.route(`${API}/api/v1/orgs/${orgFixture.orgId}/billing`, async (route) => {
    await route.fulfill({
      status: 403,
      body: JSON.stringify({ message: 'Forbidden' }),
    });
  });

  await page.goto('/account/projects');

  await page.getByLabel('Project name').fill('Blocked project');
  await page.getByRole('button', { name: 'Create project' }).click();

  await expect(page.getByText('Acme E2E billing is paused')).toBeVisible();
  await expect(
    page.getByText(/Ask an owner or admin of Acme E2E to restore billing/),
  ).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open team billing' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Creating…' })).toHaveCount(0);
  await expectNoRawI18nKeys(page, 'projects page (member reactive 402)');
});
