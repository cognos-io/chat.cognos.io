import { expect, test } from '@playwright/test';
import { createServer } from 'node:http';

import {
  buildConversationFixture,
  buildMessageRecordFixture,
  buildVaultFixture,
  seedAuthenticatedUnlockState,
} from './fixtures';

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'access-control-allow-headers': 'Authorization, Content-Type',
};

test('regenerating an answer creates a sibling branch the user can switch between', async ({
  page,
}) => {
  const userFixture = buildVaultFixture('user_e2e_regen', 'regen@example.com');
  const conversationFixture = buildConversationFixture(
    userFixture,
    'conv_e2e_regen',
    'Regenerate conversation',
  );

  const userMessage = buildMessageRecordFixture(conversationFixture, {
    id: 'msg_user_regen',
    created: '2026-06-13T22:25:00Z',
    content: 'Tell me a fact.',
    ownerId: userFixture.authState.model.id,
  });
  const assistantMessage = buildMessageRecordFixture(conversationFixture, {
    id: 'msg_assistant_regen',
    created: '2026-06-13T22:25:05Z',
    content: 'The original answer.',
    agentId: 'cognos:simple-assistant',
    modelId: 'eu-model',
    parentMessageId: userMessage.id,
  });

  let regenerateRequestBody:
    | {
        parent_message_id?: string;
        messages: Array<{ role: string; content: string }>;
      }
    | undefined;

  const server = createServer((request, response) => {
    if (request.method === 'OPTIONS') {
      response.writeHead(204, corsHeaders);
      response.end();
      return;
    }

    response.writeHead(200, {
      ...corsHeaders,
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'content-type': 'text/event-stream',
    });
    response.flushHeaders();

    response.write(
      `data: ${JSON.stringify({ type: 'delta', delta: 'A regenerated answer.' })}\n\n`,
    );

    setTimeout(() => {
      response.end(
        `data: ${JSON.stringify({
          type: 'complete',
          response: {
            assistant_message: {
              id: 'msg_assistant_regen_2',
              parent_message_id: 'msg_user_regen',
              content: 'A regenerated answer.',
              agent_id: 'cognos:simple-assistant',
              model_id: 'eu-model',
              created_at: '2026-06-13T22:26:00Z',
            },
            usage: {
              input_tokens: 5,
              output_tokens: 5,
              total_tokens: 10,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
              cost_usd: 0.01,
              cost_chf: 0.01,
              cost_rappen: 1,
              used_provider_cost: true,
            },
          },
        })}\n\n`,
      );
    }, 250);
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

    await page.route('http://localhost:8090/api/v1/user-key-pair', async (route) => {
      await route.fulfill({ json: userFixture.userKeyPairRecord });
    });
    await page.route('http://localhost:8090/api/v1/vault-session', async (route) => {
      await route.fulfill({ json: userFixture.vaultSession });
    });
    await page.route('http://localhost:8090/api/v1/user-preferences', async (route) => {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Not found' }),
      });
    });
    await page.route('http://localhost:8090/api/v1/models', async (route) => {
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
              description: 'Eligible model from the backend catalogue',
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
    await page.route('http://localhost:8090/api/v1/conversations', async (route) => {
      await route.fulfill({ json: [conversationFixture.conversationRecord] });
    });
    await page.route(
      'http://localhost:8090/api/v1/conversations/conv_e2e_regen/public-key',
      async (route) => {
        await route.fulfill({ json: conversationFixture.conversationPublicKeyRecord });
      },
    );
    await page.route(
      'http://localhost:8090/api/v1/conversations/conv_e2e_regen/secret-key',
      async (route) => {
        await route.fulfill({ json: conversationFixture.conversationSecretKeyRecord });
      },
    );
    await page.route(
      'http://localhost:8090/api/v1/conversations/conv_e2e_regen/messages?page=1&page_size=100',
      async (route) => {
        await route.fulfill({
          json: {
            page: 1,
            perPage: 100,
            totalItems: 2,
            totalPages: 1,
            items: [userMessage, assistantMessage],
          },
        });
      },
    );
    await page.route(
      'http://localhost:8090/api/v1/conversations/conv_e2e_regen/regenerate',
      async (route) => {
        if (route.request().method() === 'POST') {
          regenerateRequestBody = route.request().postDataJSON() as {
            parent_message_id?: string;
            messages: Array<{ role: string; content: string }>;
          };
        }
        await route.continue({ url: `http://127.0.0.1:${address.port}/regenerate` });
      },
    );

    await page.goto('/c/conv_e2e_regen');

    await expect(
      page.getByRole('heading', { name: 'Regenerate conversation' }),
    ).toBeVisible();
    await expect(page.getByText('The original answer.')).toBeVisible();

    const assistant = page.locator('.message-list-item__assistant');
    await assistant.hover();
    await page.getByRole('button', { name: 'Regenerate response' }).click();

    // The new branch becomes the active response.
    await expect(page.getByText('A regenerated answer.')).toBeVisible();
    await expect(page.getByText('The original answer.')).toHaveCount(0);

    // The parent user message shows a branch-point tick with the child count
    // and a rendered git-branch icon.
    const branchTick = page.locator('.cog-user-message__branch');
    await expect(branchTick).toContainText('2');
    await expect(branchTick.locator('svg path').first()).toBeAttached();

    // The regenerate request replied to the existing user message, not a new one.
    expect(regenerateRequestBody?.parent_message_id).toBe('msg_user_regen');
    expect(regenerateRequestBody?.messages.at(-1)).toMatchObject({
      role: 'user',
      content: 'Tell me a fact.',
    });

    // A pager appears showing 2 of 2; stepping back reveals the original.
    await assistant.hover();
    const pager = page.locator('.cog-branch-switcher__label');
    await expect(pager).toHaveText('2 / 2');

    await page.getByRole('button', { name: 'Previous response' }).click();
    await expect(page.getByText('The original answer.')).toBeVisible();
    await expect(page.getByText('A regenerated answer.')).toHaveCount(0);
    await expect(pager).toHaveText('1 / 2');
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
});
