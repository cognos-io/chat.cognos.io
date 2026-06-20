import { expect, test } from '@playwright/test';

import {
  buildProjectFixture,
  buildVaultFixture,
  seedAuthenticatedUnlockState,
} from './fixtures';

const API = 'http://localhost:8090';

test('creates a project and sees its decrypted name', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  const userFixture = buildVaultFixture('user_e2e_projects', 'projects@example.com');
  await seedAuthenticatedUnlockState(page, userFixture);

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
  // The settings shell (which now hosts the projects pages) loads billing.
  await page.route(`${API}/api/v1/billing`, async (route) => {
    await route.fulfill({
      json: { plan_type: 'trial', status: 'trial', balance_chf: 2, trial_seed_chf: 2 },
    });
  });

  // GET starts empty; POST echoes the encrypted blob + wrapped key back so the
  // client can build the new project from its in-memory content key.
  await page.route(`${API}/api/v1/projects`, async (route) => {
    if (route.request().method() === 'POST') {
      const body = route.request().postDataJSON() as {
        data: string;
        wrapped_project_key: string;
      };
      await route.fulfill({
        status: 201,
        json: {
          id: 'proj_created_e2e',
          created: new Date().toISOString(),
          updated: new Date().toISOString(),
          data: body.data,
          wrapped_project_key: body.wrapped_project_key,
          creator: userFixture.authState.model.id,
          key_version: 1,
        },
      });
      return;
    }
    await route.fulfill({ json: [] });
  });
  // The project detail page eagerly loads each project's conversations.
  await page.route(`${API}/api/v1/projects/*/conversations`, async (route) => {
    await route.fulfill({ json: [] });
  });

  await page.goto('/account/projects');

  await expect(
    page.getByRole('heading', { name: 'Projects', exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId('projects-empty')).toBeVisible();

  await page.getByLabel('Project name').fill('Acme launch');
  await page.getByLabel('Description').fill('Private project notes');
  await page.getByRole('button', { name: 'Create project' }).click();

  // The service navigates to the detail page; the decrypted name is rendered
  // from the in-memory content key.
  await expect(page).toHaveURL(/\/account\/projects\/proj_created_e2e$/);
  await expect(page.getByTestId('project-name')).toHaveText('Acme launch');
  await expect(page.getByTestId('project-description')).toHaveText(
    'Private project notes',
  );

  // The breadcrumb crumbs navigate: clicking "Projects" returns to the list.
  await page.getByRole('button', { name: 'Projects', exact: true }).click();
  await expect(page).toHaveURL(/\/account\/projects$/);
  await expect(page.getByTestId('projects-list')).toBeVisible();

  expect(pageErrors).toEqual([]);
});

test('decrypts an existing project on load', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  const userFixture = buildVaultFixture('user_e2e_projects2', 'projects2@example.com');
  const projectFixture = buildProjectFixture(
    userFixture,
    'proj_seeded_e2e',
    'Quarterly planning',
    'Roadmap and milestones',
  );

  await seedAuthenticatedUnlockState(page, userFixture);

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
  // The settings shell (which now hosts the projects pages) loads billing.
  await page.route(`${API}/api/v1/billing`, async (route) => {
    await route.fulfill({
      json: { plan_type: 'trial', status: 'trial', balance_chf: 2, trial_seed_chf: 2 },
    });
  });
  await page.route(`${API}/api/v1/projects`, async (route) => {
    await route.fulfill({ json: [projectFixture.projectRecord] });
  });
  await page.route(`${API}/api/v1/projects/*/conversations`, async (route) => {
    await route.fulfill({ json: [] });
  });

  await page.goto('/account/projects');

  // The encrypted name is decrypted client-side from the wrapped content key.
  await expect(page.getByTestId('projects-list')).toBeVisible();
  await expect(page.getByText('Quarterly planning')).toBeVisible();

  expect(pageErrors).toEqual([]);
});
