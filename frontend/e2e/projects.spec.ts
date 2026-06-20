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

  await page.goto('/projects');

  await expect(
    page.getByRole('heading', { name: 'Projects', exact: true }),
  ).toBeVisible();
  await expect(page.getByTestId('projects-empty')).toBeVisible();

  await page.getByRole('button', { name: 'New project' }).click();
  await page.getByLabel('Project name').fill('Acme launch');
  await page.getByLabel('Description').fill('Private project notes');
  await page.getByRole('button', { name: 'Create project' }).click();

  // The service navigates to the detail page; the decrypted name is rendered
  // from the in-memory content key.
  await expect(page).toHaveURL(/\/projects\/proj_created_e2e$/);
  await expect(page.getByTestId('project-name')).toHaveText('Acme launch');
  await expect(page.getByTestId('project-description')).toHaveText(
    'Private project notes',
  );

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
  await page.route(`${API}/api/v1/projects`, async (route) => {
    await route.fulfill({ json: [projectFixture.projectRecord] });
  });

  await page.goto('/projects');

  // The encrypted name is decrypted client-side from the wrapped content key.
  await expect(page.getByTestId('projects-list')).toBeVisible();
  await expect(page.getByText('Quarterly planning')).toBeVisible();

  expect(pageErrors).toEqual([]);
});
