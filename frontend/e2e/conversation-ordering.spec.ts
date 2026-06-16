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

const modelsResponse = {
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
};

const recentTitles = async (page: import('@playwright/test').Page) =>
  (await page.locator('.conversation-list-item__title').allTextContents()).map((t) =>
    t.trim(),
  );

test('recent conversations are ordered most-recently-updated first', async ({
  page,
}) => {
  const userFixture = buildVaultFixture('user_e2e_order', 'order@example.com');

  // alpha oldest, gamma newest
  const alpha = buildConversationFixture(userFixture, 'conv_order_alpha', 'Alpha');
  alpha.conversationRecord.updated = '2026-06-10 09:00:00.000Z';
  const beta = buildConversationFixture(userFixture, 'conv_order_beta', 'Beta');
  beta.conversationRecord.updated = '2026-06-11 10:00:00.000Z';
  const gamma = buildConversationFixture(userFixture, 'conv_order_gamma', 'Gamma');
  gamma.conversationRecord.updated = '2026-06-12 11:00:00.000Z';

  const conversations = [alpha, beta, gamma];

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
    await route.fulfill({ json: modelsResponse });
  });
  // The backend returns them oldest-first; the client must reorder.
  await page.route('http://localhost:8090/api/v1/conversations', async (route) => {
    await route.fulfill({ json: conversations.map((c) => c.conversationRecord) });
  });
  for (const conversation of conversations) {
    const id = conversation.conversationRecord.id;
    await page.route(
      `http://localhost:8090/api/v1/conversations/${id}/public-key`,
      async (route) => {
        await route.fulfill({ json: conversation.conversationPublicKeyRecord });
      },
    );
    await page.route(
      `http://localhost:8090/api/v1/conversations/${id}/secret-key`,
      async (route) => {
        await route.fulfill({ json: conversation.conversationSecretKeyRecord });
      },
    );
  }

  await page.goto('/');

  await expect(page.locator('.conversation-list-item__title')).toHaveCount(3);
  expect(await recentTitles(page)).toEqual(['Gamma', 'Beta', 'Alpha']);
});

test('sending a message bumps its conversation to the top of recent', async ({
  page,
}) => {
  const userFixture = buildVaultFixture('user_e2e_bump', 'bump@example.com');

  const alpha = buildConversationFixture(userFixture, 'conv_bump_alpha', 'Alpha');
  alpha.conversationRecord.updated = '2026-06-10 09:00:00.000Z';
  const beta = buildConversationFixture(userFixture, 'conv_bump_beta', 'Beta');
  beta.conversationRecord.updated = '2026-06-11 10:00:00.000Z';
  const gamma = buildConversationFixture(userFixture, 'conv_bump_gamma', 'Gamma');
  gamma.conversationRecord.updated = '2026-06-12 11:00:00.000Z';

  const conversations = [alpha, beta, gamma];

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
    response.end(
      `data: ${JSON.stringify({
        type: 'complete',
        response: {
          user_message_id: 'msg_bump_user',
          assistant_message: {
            id: 'msg_bump_assistant',
            parent_message_id: 'msg_bump_user',
            content: 'Got it.',
            persona_id: 'cognos:simple-assistant',
            model_id: 'eu-model',
            created_at: '2026-06-12 12:00:00.000Z',
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
            used_provider_cost: false,
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
      await route.fulfill({ json: modelsResponse });
    });
    await page.route('http://localhost:8090/api/v1/conversations', async (route) => {
      await route.fulfill({ json: conversations.map((c) => c.conversationRecord) });
    });
    for (const conversation of conversations) {
      const id = conversation.conversationRecord.id;
      await page.route(
        `http://localhost:8090/api/v1/conversations/${id}/public-key`,
        async (route) => {
          await route.fulfill({ json: conversation.conversationPublicKeyRecord });
        },
      );
      await page.route(
        `http://localhost:8090/api/v1/conversations/${id}/secret-key`,
        async (route) => {
          await route.fulfill({ json: conversation.conversationSecretKeyRecord });
        },
      );
      await page.route(
        `http://localhost:8090/api/v1/conversations/${id}/messages?page=1&page_size=100`,
        async (route) => {
          await route.fulfill({
            json: { page: 1, perPage: 100, totalItems: 0, totalPages: 1, items: [] },
          });
        },
      );
    }
    await page.route(
      'http://localhost:8090/api/v1/conversations/conv_bump_alpha/complete',
      async (route) => {
        await route.continue({ url: `http://127.0.0.1:${address.port}/complete` });
      },
    );

    // Open the oldest conversation, which starts at the bottom of recent.
    await page.goto('/c/conv_bump_alpha');
    await expect(page.getByRole('button', { name: 'EU Model' })).toBeVisible();
    await expect(page.locator('.conversation-list-item__title')).toHaveCount(3);
    expect(await recentTitles(page)).toEqual(['Gamma', 'Beta', 'Alpha']);

    const composer = page.getByPlaceholder('Message with Cognos');
    await composer.fill('A new message');
    await page.getByRole('button', { name: 'Send' }).click();

    await expect(page.getByText('A new message')).toBeVisible();
    // Alpha was just updated, so it jumps to the top of recent.
    await expect.poll(async () => (await recentTitles(page))[0]).toBe('Alpha');
    expect(await recentTitles(page)).toEqual(['Alpha', 'Gamma', 'Beta']);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});
