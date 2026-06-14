import { expect, test } from '@playwright/test';

import {
  buildConversationFixture,
  buildMessageRecordFixture,
  buildVaultFixture,
  seedAuthenticatedUnlockState,
} from './fixtures';

const seedConversation = async (page: import('@playwright/test').Page) => {
  const userFixture = buildVaultFixture('user_e2e', 'e2e@example.com');
  const conversationFixture = buildConversationFixture(
    userFixture,
    'conv_e2e_actions',
    'Action alignment',
  );

  const userMessage = buildMessageRecordFixture(conversationFixture, {
    id: 'msg_user_actions',
    created: '2026-06-13T22:25:00Z',
    content: 'hello there',
    ownerId: userFixture.authState.model.id,
  });
  const assistantMessage = buildMessageRecordFixture(conversationFixture, {
    id: 'msg_assistant_actions',
    created: '2026-06-13T22:25:05Z',
    content: 'A short assistant reply.',
    agentId: 'cognos:simple-assistant',
    modelId: 'eu-model',
    parentMessageId: userMessage.id,
  });

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
    'http://localhost:8090/api/v1/conversations/conv_e2e_actions/public-key',
    async (route) => {
      await route.fulfill({ json: conversationFixture.conversationPublicKeyRecord });
    },
  );
  await page.route(
    'http://localhost:8090/api/v1/conversations/conv_e2e_actions/secret-key',
    async (route) => {
      await route.fulfill({ json: conversationFixture.conversationSecretKeyRecord });
    },
  );
  await page.route(
    'http://localhost:8090/api/v1/conversations/conv_e2e_actions/messages?page=1&page_size=100',
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
};

const rightEdge = async (locator: import('@playwright/test').Locator) => {
  const box = await locator.boundingBox();
  expect(box).not.toBeNull();
  return box!.x + box!.width;
};

test('assistant action buttons align to the right edge of the message', async ({
  page,
}) => {
  await seedConversation(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/c/conv_e2e_actions');

  const assistant = page.locator('.message-list-item__assistant');
  await expect(assistant).toBeVisible();

  const content = assistant.locator('.cog-assistant-message__content');
  // The action toolbar lives within the assistant message item.
  const actions = page
    .locator('.message-list-item', { has: assistant })
    .locator('.message-list-item__actions');

  const contentRight = await rightEdge(content);
  const actionsRight = await rightEdge(actions);
  const viewport = page.viewportSize()!;

  // Actions hug the message's right edge, not the far side of the screen.
  expect(Math.abs(actionsRight - contentRight)).toBeLessThanOrEqual(2);
  expect(actionsRight).toBeLessThan(viewport.width - 120);
});
