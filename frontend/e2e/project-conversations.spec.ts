import { expect, test } from '@playwright/test';

import {
  buildProjectConversationFixture,
  buildProjectFixture,
  buildVaultFixture,
  seedAuthenticatedUnlockState,
} from './fixtures';

const API = 'http://localhost:8090';

// Routes every authenticated surface touches on unlock, so the projects flow
// runs without a real backend.
const seedBaseRoutes = async (
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
  // The settings shell that hosts the projects pages loads billing.
  await page.route(`${API}/api/v1/billing`, async (route) => {
    await route.fulfill({
      json: { plan_type: 'trial', status: 'trial', balance_chf: 2, trial_seed_chf: 2 },
    });
  });
};

test('decrypts a project conversation and shows it under the project', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  const userFixture = buildVaultFixture('user_e2e_pc1', 'pc1@example.com');
  const projectFixture = buildProjectFixture(userFixture, 'proj_pc_1', 'Acme launch');
  const conversationFixture = buildProjectConversationFixture(
    projectFixture,
    'pconv_e2e_0001',
    'Design notes',
  );

  await seedAuthenticatedUnlockState(page, userFixture);
  await seedBaseRoutes(page, userFixture);

  await page.route(`${API}/api/v1/projects`, async (route) => {
    await route.fulfill({ json: [projectFixture.projectRecord] });
  });
  await page.route(
    `${API}/api/v1/projects/${projectFixture.projectRecord.id}/conversations`,
    async (route) => {
      await route.fulfill({ json: [conversationFixture.record] });
    },
  );

  await page.goto(`/account/projects/${projectFixture.projectRecord.id}`);

  // Project name decrypts, and the project conversation title decrypts via the
  // project content key → wrapped conversation secret key.
  await expect(page.getByTestId('project-name')).toHaveText('Acme launch');
  await expect(page.getByTestId('project-conversations')).toBeVisible();
  await expect(page.getByText('Design notes')).toBeVisible();

  expect(pageErrors).toEqual([]);
});

test('shows a Projects group and project chats in the chat sidebar', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  const userFixture = buildVaultFixture('user_e2e_pc3', 'pc3@example.com');
  const projectFixture = buildProjectFixture(userFixture, 'proj_pc_3', 'Acme launch');
  const conversationFixture = buildProjectConversationFixture(
    projectFixture,
    'pconv_e2e_side1',
    'Design notes',
  );

  await seedAuthenticatedUnlockState(page, userFixture);
  await seedBaseRoutes(page, userFixture);

  await page.route(`${API}/api/v1/models`, async (route) => {
    await route.fulfill({
      json: { privacy_tier: 'eu', preferred_model_id: '', models: [] },
    });
  });
  await page.route(`${API}/api/v1/projects`, async (route) => {
    await route.fulfill({ json: [projectFixture.projectRecord] });
  });
  await page.route(
    `${API}/api/v1/projects/${projectFixture.projectRecord.id}/conversations`,
    async (route) => {
      await route.fulfill({ json: [conversationFixture.record] });
    },
  );

  await page.goto('/');

  // The project appears in a "Projects" group, linking to the project page.
  await expect(page.getByRole('link', { name: 'Acme launch' })).toHaveAttribute(
    'href',
    /\/account\/projects\/proj_pc_3$/,
  );

  // The project chat appears in the recent list (all chats, project or not).
  await expect(page.getByText('Design notes')).toBeVisible();

  expect(pageErrors).toEqual([]);
});

test('creates a chat inside a project and opens it', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  const userFixture = buildVaultFixture('user_e2e_pc2', 'pc2@example.com');
  const projectFixture = buildProjectFixture(userFixture, 'proj_pc_2', 'Roadmap');
  const newConversationId = 'pconv_created01';

  await seedAuthenticatedUnlockState(page, userFixture);
  await seedBaseRoutes(page, userFixture);

  await page.route(`${API}/api/v1/projects`, async (route) => {
    await route.fulfill({ json: [projectFixture.projectRecord] });
  });

  let createdData = '';
  let createdWrappedKey = '';
  await page.route(
    `${API}/api/v1/projects/${projectFixture.projectRecord.id}/conversations`,
    async (route) => {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON() as {
          data: string;
          wrapped_conversation_secret_key: string;
        };
        createdData = body.data;
        createdWrappedKey = body.wrapped_conversation_secret_key;
        await route.fulfill({
          status: 201,
          json: {
            id: newConversationId,
            created: new Date().toISOString(),
            updated: new Date().toISOString(),
            data: body.data,
            project: projectFixture.projectRecord.id,
            key_version: 1,
            project_key_version: 1,
            wrapped_conversation_secret_key: body.wrapped_conversation_secret_key,
          },
        });
        return;
      }
      await route.fulfill({ json: [] });
    },
  );

  // The chat view the new conversation opens into needs models + an (empty)
  // message list. Mock them so navigation doesn't error.
  await page.route(`${API}/api/v1/models`, async (route) => {
    await route.fulfill({
      json: { privacy_tier: 'eu', preferred_model_id: '', models: [] },
    });
  });
  await page.route(
    new RegExp(`${API}/api/v1/conversations/${newConversationId}/messages.*`),
    async (route) => {
      await route.fulfill({
        json: { page: 1, perPage: 100, totalItems: 0, totalPages: 0, items: [] },
      });
    },
  );

  await page.goto(`/account/projects/${projectFixture.projectRecord.id}`);
  await expect(page.getByTestId('project-no-conversations')).toBeVisible();

  await page.getByPlaceholder('Name this chat (optional)').fill('Kickoff');
  await page.getByRole('button', { name: 'New chat' }).click();

  // The service creates the conversation and navigates to the chat view.
  await expect(page).toHaveURL(new RegExp(`/c/${newConversationId}$`));

  // The client encrypted the title and wrapped the secret key before sending.
  expect(createdData.length).toBeGreaterThan(0);
  expect(createdWrappedKey.length).toBeGreaterThan(0);

  expect(pageErrors).toEqual([]);
});
