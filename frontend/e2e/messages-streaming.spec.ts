import { expect, test } from '@playwright/test';
import { createServer } from 'node:http';

import {
  buildConversationFixture,
  buildVaultFixture,
  seedAuthenticatedUnlockState,
} from './fixtures';

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'access-control-allow-headers': 'Authorization, Content-Type',
};

test('assistant responses stream progressively on the existing completion endpoint', async ({
  page,
}) => {
  const userFixture = buildVaultFixture('user_e2e_stream', 'stream@example.com');
  const conversationFixture = buildConversationFixture(
    userFixture,
    'conv_e2e_stream',
    'Streaming conversation',
  );

  let completionRequestBody:
    | {
        model_id: string;
        persona_id: string;
        system_prompt: string;
        messages: Array<{ role: string; content: string }>;
      }
    | undefined;

  const server = createServer((request, response) => {
    if (request.method === 'OPTIONS') {
      response.writeHead(204, corsHeaders);
      response.end();
      return;
    }

    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (request.method !== 'POST' || url.pathname !== '/stream') {
      response.writeHead(404, {
        ...corsHeaders,
        'content-type': 'application/json',
      });
      response.end(JSON.stringify({ message: 'Not found' }));
      return;
    }

    response.writeHead(200, {
      ...corsHeaders,
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'content-type': 'text/event-stream',
    });
    response.flushHeaders();

    response.write(`data: ${JSON.stringify({ type: 'delta', delta: 'Hi from ' })}\n\n`);

    setTimeout(() => {
      response.write(
        `data: ${JSON.stringify({ type: 'delta', delta: 'the streamed backend' })}\n\n`,
      );

      setTimeout(() => {
        response.end(
          `data: ${JSON.stringify({
            type: 'complete',
            response: {
              user_message_id: 'msg_user_stream_1',
              assistant_message: {
                id: 'msg_assistant_stream_1',
                parent_message_id: 'msg_user_stream_1',
                content: 'Hi from the streamed backend',
                persona_id: 'cognos:simple-assistant',
                model_id: 'eu-model',
                created_at: '2026-06-07T00:00:00Z',
              },
              usage: {
                input_tokens: 12,
                output_tokens: 8,
                total_tokens: 20,
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: 0,
                cost_usd: 0.02,
                cost_chf: 0.02,
                cost_rappen: 2,
                used_provider_cost: true,
              },
            },
          })}\n\n`,
        );
      }, 1500);
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
      'http://localhost:8090/api/v1/conversations/conv_e2e_stream/public-key',
      async (route) => {
        await route.fulfill({ json: conversationFixture.conversationPublicKeyRecord });
      },
    );

    await page.route(
      'http://localhost:8090/api/v1/conversations/conv_e2e_stream/secret-key',
      async (route) => {
        await route.fulfill({ json: conversationFixture.conversationSecretKeyRecord });
      },
    );

    await page.route(
      'http://localhost:8090/api/v1/conversations/conv_e2e_stream/messages?page=1&page_size=100',
      async (route) => {
        await route.fulfill({
          json: {
            page: 1,
            perPage: 100,
            totalItems: 0,
            totalPages: 1,
            items: [],
          },
        });
      },
    );

    await page.route(
      'http://localhost:8090/api/v1/conversations/conv_e2e_stream/complete',
      async (route) => {
        if (route.request().method() === 'POST') {
          completionRequestBody = route.request().postDataJSON() as {
            model_id: string;
            persona_id: string;
            system_prompt: string;
            messages: Array<{ role: string; content: string }>;
          };
        }

        await route.continue({
          url: `http://127.0.0.1:${address.port}/stream`,
        });
      },
    );

    await page.goto('/c/conv_e2e_stream');

    await expect(
      page.getByRole('heading', { name: 'Streaming conversation' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'EU Model' })).toBeVisible();

    const composer = page.getByLabel('Message Cognos — encrypted on this device');
    await composer.fill('Hello from streaming e2e');
    await page.getByRole('button', { name: 'Send' }).click();

    await expect(page.getByText('Hello from streaming e2e')).toBeVisible();

    const streamingAssistantMessage = page
      .locator('.message-list-item__streaming')
      .last();
    await expect(streamingAssistantMessage).toBeVisible();
    await expect(streamingAssistantMessage).toContainText('Hi from');

    const finalAssistantMessage = page
      .locator('.message-list-item__assistant markdown p')
      .last();
    await expect(finalAssistantMessage).toHaveText('Hi from the streamed backend');

    expect(completionRequestBody?.model_id).toBe('eu-model');
    expect(completionRequestBody?.persona_id).toBe('cognos:simple-assistant');
    expect(completionRequestBody?.system_prompt).toContain('accurate, factual');
    expect(completionRequestBody?.messages.at(-1)).toMatchObject({
      role: 'user',
      content: 'Hello from streaming e2e',
    });
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
