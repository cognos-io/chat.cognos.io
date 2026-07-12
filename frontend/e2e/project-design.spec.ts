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

  // The Projects heading has a "+" shortcut to the new-project page.
  await expect(page.getByRole('link', { name: 'New project' })).toHaveAttribute(
    'href',
    /\/account\/projects$/,
  );

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

test('project settings dialog offers a transparent icon colour', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  const userFixture = buildVaultFixture('user_e2e_pd6', 'pd6@example.com');
  const projectFixture = buildProjectFixture(
    userFixture,
    'proj_pd_6',
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
  // Default colour is the slate chip.
  await expect(
    page.locator('.project-detail__header .persona-avatar--slate'),
  ).toBeVisible();

  await page.getByRole('button', { name: 'Settings' }).click();
  await page.getByRole('radio', { name: 'transparent' }).click();
  await page.getByTestId('project-settings-save').click();

  // The saved transparent colour is reflected on the header avatar chip.
  await expect(
    page.locator('.project-detail__header .persona-avatar--transparent'),
  ).toBeVisible();

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

test('project page orders chats by last activity, most recent first', async ({
  page,
}) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  const userFixture = buildVaultFixture('user_e2e_pd5', 'pd5@example.com');
  const projectFixture = buildProjectFixture(
    userFixture,
    'proj_pd_5',
    'Cantonal Policy',
  );
  // Older activity than the second chat, but returned first by the backend.
  const older = buildProjectConversationFixture(
    projectFixture,
    'pconv_pd_old',
    'Older chat',
    '2026-01-01T00:00:00.000Z',
  );
  const newer = buildProjectConversationFixture(
    projectFixture,
    'pconv_pd_new',
    'Newer chat',
    '2026-06-01T00:00:00.000Z',
  );

  await seedAuthenticatedUnlockState(page, userFixture);
  await seedBaseRoutes(page, userFixture);
  await page.route(`${API}/api/v1/projects`, async (route) => {
    await route.fulfill({ json: [projectFixture.projectRecord] });
  });
  await page.route(
    `${API}/api/v1/projects/${projectFixture.projectRecord.id}/conversations`,
    async (route) => {
      await route.fulfill({ json: [older.record, newer.record] });
    },
  );

  await page.goto(`/account/projects/${projectFixture.projectRecord.id}`);
  await expect(page.getByTestId('project-name')).toHaveText('Cantonal Policy');

  // The most-recently-active chat is listed first regardless of backend order.
  const titles = page.locator(
    '[data-testid="project-conversations"] .project-detail__chat-title',
  );
  await expect(titles).toHaveText(['Newer chat', 'Older chat']);

  expect(pageErrors).toEqual([]);
});

test('project chats show a last-activity label', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  const userFixture = buildVaultFixture('user_e2e_pd7', 'pd7@example.com');
  const projectFixture = buildProjectFixture(
    userFixture,
    'proj_pd_7',
    'Cantonal Policy',
  );
  // Far in the past (midday UTC so the calendar date is timezone-stable) → the
  // label falls back to the absolute YYYY/MM/DD form.
  const chat = buildProjectConversationFixture(
    projectFixture,
    'pconv_pd_dated',
    'Archived chat',
    '2020-01-02T12:00:00.000Z',
  );

  await seedAuthenticatedUnlockState(page, userFixture);
  await seedBaseRoutes(page, userFixture);
  await page.route(`${API}/api/v1/projects`, async (route) => {
    await route.fulfill({ json: [projectFixture.projectRecord] });
  });
  await page.route(
    `${API}/api/v1/projects/${projectFixture.projectRecord.id}/conversations`,
    async (route) => {
      await route.fulfill({ json: [chat.record] });
    },
  );

  await page.goto(`/account/projects/${projectFixture.projectRecord.id}`);
  await expect(page.getByTestId('project-name')).toHaveText('Cantonal Policy');

  await expect(page.locator('.project-detail__chat-meta')).toHaveText('2020/01/02');

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

test('PII in project instructions is redacted before reaching the model and hydrates back', async ({
  page,
}) => {
  const userFixture = buildVaultFixture('user_e2e_pdpii', 'pdpii@example.com');
  const secret = 'officer@example.com';
  const instructions = `Escalate approvals to ${secret} only.`;
  const projectFixture = buildProjectFixture(
    userFixture,
    'proj_pd_pii',
    'Cantonal Policy',
    '',
    instructions,
  );
  const conversationFixture = buildProjectConversationFixture(
    projectFixture,
    'pconv_pd_pii',
    'Policy chat',
  );
  const conversationId = conversationFixture.record.id;
  const tokenRe = /\[\[PII_EMAIL_[A-Z0-9]+\]\]/;

  let systemPrompt = '';
  let entriesBody:
    | {
        entries: Array<{
          token: string;
          data: string;
          source_kind: string;
          source_id: string;
        }>;
      }
    | undefined;

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
    `${API}/api/v1/conversations/${conversationId}/messages?page=1&page_size=100`,
    async (route) => {
      await route.fulfill({
        json: { page: 1, perPage: 100, totalItems: 0, totalPages: 1, items: [] },
      });
    },
  );

  // Redaction key: none yet (GET 404), created on first persist (POST).
  await page.route(
    `${API}/api/v1/conversations/${conversationId}/redaction-key`,
    async (route) => {
      if (route.request().method() === 'POST') {
        await route.fulfill({ json: { key_version: 1 } });
        return;
      }
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Not found' }),
      });
    },
  );

  // Redaction entries: empty on load; capture what gets persisted.
  await page.route(
    `${API}/api/v1/conversations/${conversationId}/redaction-entries`,
    async (route) => {
      if (route.request().method() === 'POST') {
        entriesBody = route.request().postDataJSON();
        await route.fulfill({
          json: { created: entriesBody?.entries.map((entry) => entry.token) ?? [] },
        });
        return;
      }
      await route.fulfill({ json: { items: [] } });
    },
  );

  // Capture the system prompt and echo back the placeholder token as the
  // assistant reply, so we can assert it hydrates on display.
  await page.route(
    `${API}/api/v1/conversations/${conversationId}/complete`,
    async (route) => {
      const body = route.request().postDataJSON() as { system_prompt: string };
      systemPrompt = body.system_prompt;
      const token = (systemPrompt.match(tokenRe) ?? [''])[0];
      const sse = `data: ${JSON.stringify({
        type: 'complete',
        response: {
          user_message_id: 'u_pii_1',
          assistant_message: {
            id: 'a_pii_1',
            parent_message_id: 'u_pii_1',
            content: `Approvals go to ${token}.`,
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
      })}\n\n`;
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' },
        body: sse,
      });
    },
  );

  await page.goto(`/c/${conversationId}`);
  await expect(page.getByRole('heading', { name: 'Policy chat' })).toBeVisible();

  await page
    .getByLabel('Message Cognos — stored encrypted; sent to your provider to reply')
    .fill('Draft the memo.');
  await page.getByRole('button', { name: 'Send' }).click();

  // 1. The raw PII never reaches the model; a placeholder token takes its place.
  await expect.poll(() => systemPrompt).toMatch(tokenRe);
  expect(systemPrompt).not.toContain(secret);

  // 2. The PII→token mapping is persisted to THIS chat, tagged to the project
  //    instructions (source_kind 'document').
  await expect.poll(() => entriesBody?.entries?.length ?? 0).toBeGreaterThan(0);
  const persisted = entriesBody!.entries[0];
  expect(persisted.token).toMatch(tokenRe);
  expect(persisted.token).toBe(systemPrompt.match(tokenRe)![0]);
  expect(persisted.source_kind).toBe('document');
  expect(persisted.source_id).toBe(projectFixture.projectRecord.id);
  expect(persisted.data.length).toBeGreaterThan(0);

  // 3. The token the model echoed hydrates back to the original on display.
  await expect(
    page.locator('.message-list-item__assistant').getByText(secret),
  ).toBeVisible();
});
