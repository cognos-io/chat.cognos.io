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

// A reasoning-capable response interleaves reasoning_delta events (the model's
// thinking) with the normal answer deltas. The UI must surface reasoning in its
// own disclosure — streamed live, collapsed once complete — and never mix it
// into the final answer.
test('assistant reasoning streams into its own disclosure, separate from the answer', async ({
  page,
}) => {
  const userFixture = buildVaultFixture('user_e2e_reasoning', 'reasoning@example.com');
  const conversationFixture = buildConversationFixture(
    userFixture,
    'conv_e2e_reasoning',
    'Reasoning conversation',
  );

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

    // Reasoning arrives first, on its own event type.
    response.write(
      `data: ${JSON.stringify({ type: 'reasoning_delta', delta: 'Weighing ' })}\n\n`,
    );
    response.write(
      `data: ${JSON.stringify({ type: 'reasoning_delta', delta: 'the options.' })}\n\n`,
    );

    setTimeout(() => {
      response.write(
        `data: ${JSON.stringify({ type: 'delta', delta: 'The answer ' })}\n\n`,
      );

      setTimeout(() => {
        response.end(
          `data: ${JSON.stringify({
            type: 'complete',
            response: {
              user_message_id: 'msg_user_reasoning_1',
              assistant_message: {
                id: 'msg_assistant_reasoning_1',
                parent_message_id: 'msg_user_reasoning_1',
                content: 'The answer is 42.',
                reasoning: 'Weighing the options.',
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
                reasoning_tokens: 6,
                cost_usd: 0.02,
                cost_chf: 0.02,
                cost_rappen: 2,
                used_provider_cost: true,
              },
            },
          })}\n\n`,
        );
      }, 1200);
    }, 1200);
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
              tags: [{ title: 'reasoning' }],
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
      'http://localhost:8090/api/v1/conversations/conv_e2e_reasoning/public-key',
      async (route) => {
        await route.fulfill({ json: conversationFixture.conversationPublicKeyRecord });
      },
    );

    await page.route(
      'http://localhost:8090/api/v1/conversations/conv_e2e_reasoning/secret-key',
      async (route) => {
        await route.fulfill({ json: conversationFixture.conversationSecretKeyRecord });
      },
    );

    await page.route(
      'http://localhost:8090/api/v1/conversations/conv_e2e_reasoning/messages?page=1&page_size=100',
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
      'http://localhost:8090/api/v1/conversations/conv_e2e_reasoning/complete',
      async (route) => {
        await route.continue({
          url: `http://127.0.0.1:${address.port}/stream`,
        });
      },
    );

    await page.goto('/c/conv_e2e_reasoning');

    await expect(
      page.getByRole('heading', { name: 'Reasoning conversation' }),
    ).toBeVisible();

    const composer = page.getByLabel(
      'Message Cognos — stored encrypted; sent to your provider to reply',
    );
    await composer.fill('What is the answer?');
    await page.getByRole('button', { name: 'Send' }).click();

    // While streaming, reasoning is surfaced live in its own disclosure body.
    const reasoningBody = page.locator('.message-list-item__reasoning-body');
    await expect(reasoningBody).toContainText('Weighing the options.');

    // The final answer renders and must not contain the reasoning text.
    const finalAssistantMessage = page
      .locator('.message-list-item__assistant markdown p')
      .last();
    await expect(finalAssistantMessage).toHaveText('The answer is 42.');
    await expect(finalAssistantMessage).not.toContainText('Weighing');

    // Once complete the disclosure collapses by default.
    const toggle = page.getByRole('button', { name: 'Show reasoning' });
    await expect(toggle).toBeVisible();
    await expect(reasoningBody).toHaveCount(0);

    // Opening it reveals the reasoning text and the honesty caption.
    await toggle.click();
    await expect(reasoningBody).toContainText('Weighing the options.');
    await expect(reasoningBody).toContainText('may be incomplete or incorrect');
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
