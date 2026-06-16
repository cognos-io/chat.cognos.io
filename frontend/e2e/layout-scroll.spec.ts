import { expect, test } from '@playwright/test';

import {
  buildConversationFixture,
  buildMessageRecordFixture,
  buildVaultFixture,
  seedAuthenticatedUnlockState,
} from './fixtures';

const longParagraph = (label: string) =>
  Array.from(
    { length: 40 },
    (_, i) => `${label} line ${i + 1}: ${'word '.repeat(20)}`,
  ).join('\n');

const seedLongConversation = async (page: import('@playwright/test').Page) => {
  const userFixture = buildVaultFixture('user_e2e', 'e2e@example.com');
  const conversationFixture = buildConversationFixture(
    userFixture,
    'conv_e2e_scroll',
    'Stock Market Overview',
  );

  const userMessage = buildMessageRecordFixture(conversationFixture, {
    id: 'msg_user_scroll',
    created: '2026-06-13T22:25:00Z',
    content: 'tell me about the stock market',
    ownerId: userFixture.authState.model.id,
  });
  const assistantMessage = buildMessageRecordFixture(conversationFixture, {
    id: 'msg_assistant_scroll',
    created: '2026-06-13T22:25:05Z',
    content: longParagraph('The stock market is a network of exchanges'),
    personaId: 'cognos:simple-assistant',
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
    'http://localhost:8090/api/v1/conversations/conv_e2e_scroll/public-key',
    async (route) => {
      await route.fulfill({ json: conversationFixture.conversationPublicKeyRecord });
    },
  );
  await page.route(
    'http://localhost:8090/api/v1/conversations/conv_e2e_scroll/secret-key',
    async (route) => {
      await route.fulfill({ json: conversationFixture.conversationSecretKeyRecord });
    },
  );
  await page.route(
    'http://localhost:8090/api/v1/conversations/conv_e2e_scroll/messages?page=1&page_size=100',
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

const expectNoDocumentScroll = async (page: import('@playwright/test').Page) => {
  const overflow = await page.evaluate(() => {
    const el = document.scrollingElement ?? document.documentElement;
    return el.scrollHeight - el.clientHeight;
  });
  // Allow a 1px rounding tolerance.
  expect(overflow).toBeLessThanOrEqual(1);
};

const expectComposerInViewport = async (page: import('@playwright/test').Page) => {
  const composer = page.getByPlaceholder('Message with Cognos');
  await expect(composer).toBeVisible();
  const box = await composer.boundingBox();
  const viewport = page.viewportSize();
  expect(box).not.toBeNull();
  expect(viewport).not.toBeNull();
  expect(box!.y + box!.height).toBeLessThanOrEqual(viewport!.height + 1);
};

test('desktop keeps the composer visible and scrolls messages internally', async ({
  page,
}) => {
  await seedLongConversation(page);
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/c/conv_e2e_scroll');

  await expect(
    page.getByRole('heading', { name: 'Stock Market Overview' }),
  ).toBeVisible();

  await expectComposerInViewport(page);
  await expectNoDocumentScroll(page);
});

test('mobile keeps the composer visible and scrolls messages internally', async ({
  page,
}) => {
  await seedLongConversation(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/c/conv_e2e_scroll');

  await expect(
    page.getByRole('heading', { name: 'Stock Market Overview' }),
  ).toBeVisible();

  await expectComposerInViewport(page);
  await expectNoDocumentScroll(page);
});
