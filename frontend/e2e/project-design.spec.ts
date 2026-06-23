import { expect, test } from '@playwright/test';
import { createServer } from 'node:http';

import {
  buildProjectConversationFixture,
  buildProjectFixture,
  buildVaultFixture,
  seedAuthenticatedUnlockState,
} from './fixtures';

const API = 'http://localhost:8090';

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'access-control-allow-headers': 'Authorization, Content-Type',
};

// Routes every authenticated surface touches on unlock, so the project flows
// run without a real backend.
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
  await page.route(`${API}/api/v1/billing`, async (route) => {
    await route.fulfill({
      json: { plan_type: 'trial', status: 'trial', balance_chf: 2, trial_seed_chf: 2 },
    });
  });
};

test('sidebar collapses and expands a project to reveal its chats and count', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  const userFixture = buildVaultFixture('user_e2e_pd1', 'pd1@example.com');
  const projectFixture = buildProjectFixture(
    userFixture,
    'proj_pd_1',
    'Cantonal Policy',
  );
  const chatA = buildProjectConversationFixture(
    projectFixture,
    'pconv_pd_a',
    'Data Protection Act',
  );
  const chatB = buildProjectConversationFixture(
    projectFixture,
    'pconv_pd_b',
    'Consultation response',
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
      await route.fulfill({ json: [chatA.record, chatB.record] });
    },
  );

  await page.goto('/');

  // The project shows its name and a chat count, but its chats are nested and
  // hidden until expanded.
  await expect(page.getByRole('link', { name: 'Cantonal Policy' })).toBeVisible();
  await expect(page.locator('.chat-shell__project-count')).toHaveText('2');
  await expect(page.getByText('Data Protection Act')).toBeHidden();

  const toggle = page.getByRole('button', { name: /Show chats in Cantonal Policy/ });
  await toggle.click();

  await expect(page.getByText('Data Protection Act')).toBeVisible();
  await expect(page.getByText('Consultation response')).toBeVisible();

  // Collapsing hides them again.
  await page.getByRole('button', { name: /Hide chats in Cantonal Policy/ }).click();
  await expect(page.getByText('Data Protection Act')).toBeHidden();

  expect(pageErrors).toEqual([]);
});

test('project settings dialog renames the project', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  const userFixture = buildVaultFixture('user_e2e_pd2', 'pd2@example.com');
  const projectFixture = buildProjectFixture(userFixture, 'proj_pd_2', 'Old name');

  await seedAuthenticatedUnlockState(page, userFixture);
  await seedBaseRoutes(page, userFixture);

  let patched = false;
  await page.route(`${API}/api/v1/projects`, async (route) => {
    await route.fulfill({ json: [projectFixture.projectRecord] });
  });
  await page.route(
    `${API}/api/v1/projects/${projectFixture.projectRecord.id}`,
    async (route) => {
      if (route.request().method() === 'PATCH') {
        const body = route.request().postDataJSON() as { data: string };
        patched = true;
        await route.fulfill({
          json: { ...projectFixture.projectRecord, data: body.data },
        });
        return;
      }
      await route.fallback();
    },
  );
  await page.route(`${API}/api/v1/projects/*/conversations`, async (route) => {
    await route.fulfill({ json: [] });
  });

  await page.goto(`/account/projects/${projectFixture.projectRecord.id}`);
  await expect(page.getByTestId('project-name')).toHaveText('Old name');

  await page.getByRole('button', { name: 'Settings' }).click();
  await expect(page.getByText('Project settings')).toBeVisible();

  const nameField = page.getByTestId('project-settings-name');
  await nameField.fill('New name');
  await page.getByTestId('project-settings-save').click();

  // The header reflects the re-encrypted metadata from the in-memory key.
  await expect(page.getByTestId('project-name')).toHaveText('New name');
  expect(patched).toBe(true);

  expect(pageErrors).toEqual([]);
});

test('project instructions can be added inline and persist on the page', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  const userFixture = buildVaultFixture('user_e2e_pd3', 'pd3@example.com');
  const projectFixture = buildProjectFixture(
    userFixture,
    'proj_pd_3',
    'Cantonal Policy',
  );

  await seedAuthenticatedUnlockState(page, userFixture);
  await seedBaseRoutes(page, userFixture);

  await page.route(`${API}/api/v1/projects`, async (route) => {
    await route.fulfill({ json: [projectFixture.projectRecord] });
  });
  await page.route(
    `${API}/api/v1/projects/${projectFixture.projectRecord.id}`,
    async (route) => {
      if (route.request().method() === 'PATCH') {
        const body = route.request().postDataJSON() as { data: string };
        await route.fulfill({
          json: { ...projectFixture.projectRecord, data: body.data },
        });
        return;
      }
      await route.fallback();
    },
  );
  await page.route(`${API}/api/v1/projects/*/conversations`, async (route) => {
    await route.fulfill({ json: [] });
  });

  await page.goto(`/account/projects/${projectFixture.projectRecord.id}`);
  await expect(page.getByTestId('project-name')).toHaveText('Cantonal Policy');

  await page.getByTestId('project-instructions-edit').click();
  await page
    .getByTestId('project-instructions-input')
    .fill('Cite Swiss federal and cantonal sources.');
  await page.getByTestId('project-instructions-save').click();

  await expect(page.getByTestId('project-instructions')).toHaveText(
    'Cite Swiss federal and cantonal sources.',
  );

  expect(pageErrors).toEqual([]);
});

test('project instructions are prepended to the chat system prompt', async ({
  page,
}) => {
  const userFixture = buildVaultFixture('user_e2e_pd4', 'pd4@example.com');
  const instructions = 'Cite Swiss federal sources. Never include personal data.';
  const projectFixture = buildProjectFixture(
    userFixture,
    'proj_pd_4',
    'Cantonal Policy',
    '',
    instructions,
  );
  const conversationFixture = buildProjectConversationFixture(
    projectFixture,
    'pconv_pd_sys',
    'Policy chat',
  );

  let completionRequestBody: { system_prompt: string } | undefined;

  // A minimal SSE server that records the completion request and returns a
  // single complete event so the send settles cleanly.
  const server = createServer((request, response) => {
    if (request.method === 'OPTIONS') {
      response.writeHead(204, corsHeaders);
      response.end();
      return;
    }
    response.writeHead(200, {
      ...corsHeaders,
      'cache-control': 'no-cache, no-transform',
      'content-type': 'text/event-stream',
    });
    response.end(
      `data: ${JSON.stringify({
        type: 'complete',
        response: {
          user_message_id: 'msg_user_sys_1',
          assistant_message: {
            id: 'msg_assistant_sys_1',
            parent_message_id: 'msg_user_sys_1',
            content: 'Understood.',
            persona_id: 'cognos:simple-assistant',
            model_id: 'eu-model',
            created_at: '2026-06-07T00:00:00Z',
          },
          usage: {
            input_tokens: 1,
            output_tokens: 1,
            total_tokens: 2,
            cache_creation_input_tokens: 0,
            cache_read_input_tokens: 0,
            cost_usd: 0,
            cost_chf: 0,
            cost_rappen: 0,
            used_provider_cost: true,
          },
        },
      })}\n\n`,
    );
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to determine mock stream server address.');
  }

  try {
    await seedAuthenticatedUnlockState(page, userFixture);
    await seedBaseRoutes(page, userFixture);

    await page.route(`${API}/api/v1/models`, async (route) => {
      await route.fulfill({
        json: {
          privacy_tier: 'eu',
          preferred_model_id: 'eu-model',
          models: [
            {
              id: 'eu-model',
              name: 'EU Model',
              slug: 'eu-model',
              provider_id: 'infomaniak',
              provider_model_id: 'eu-model',
              description: 'Eligible model',
              privacy_tier: 'eu',
              tags: [{ title: 'switzerland' }],
              content_types: ['text'],
              input_context_tokens: 64000,
              max_output_tokens: 8192,
              pricing: {
                input_usd_per_million_tokens: 1,
                output_usd_per_million_tokens: 2,
              },
              is_eligible: true,
            },
          ],
        },
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
    await page.route(
      `${API}/api/v1/conversations/${conversationFixture.record.id}/messages?page=1&page_size=100`,
      async (route) => {
        await route.fulfill({
          json: { page: 1, perPage: 100, totalItems: 0, totalPages: 1, items: [] },
        });
      },
    );
    await page.route(
      `${API}/api/v1/conversations/${conversationFixture.record.id}/complete`,
      async (route) => {
        if (route.request().method() === 'POST') {
          completionRequestBody = route.request().postDataJSON() as {
            system_prompt: string;
          };
        }
        await route.continue({ url: `http://127.0.0.1:${address.port}/stream` });
      },
    );

    await page.goto(`/c/${conversationFixture.record.id}`);
    await expect(page.getByRole('heading', { name: 'Policy chat' })).toBeVisible();

    const composer = page.getByLabel(
      'Message Cognos — stored encrypted; sent to your provider to reply',
    );
    await composer.fill('Draft a memo.');
    await page.getByRole('button', { name: 'Send' }).click();

    await expect(page.getByText('Draft a memo.')).toBeVisible();
    await expect
      .poll(() => completionRequestBody?.system_prompt)
      .toContain(instructions);
  } finally {
    server.close();
  }
});
