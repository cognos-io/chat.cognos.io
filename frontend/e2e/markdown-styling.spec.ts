import { expect, test } from '@playwright/test';

import {
  buildConversationFixture,
  buildMessageRecordFixture,
  buildVaultFixture,
  seedAuthenticatedUnlockState,
} from './fixtures';

const markdownContent = [
  '# Heading One',
  '',
  '## Heading Two',
  '',
  'A paragraph of body text for comparison.',
  '',
  '> [!TIP]',
  '> A helpful callout.',
  '',
  '- Item A',
  '- Item B',
  '',
  '- [ ] Todo task',
  '- [x] Done task',
  '',
  '| Feature | Status |',
  '| :--- | :--- |',
  '| Tables | Working |',
  '',
  'A claim with a footnote.[^1]',
  '',
  '[^1]: The footnote definition.',
].join('\n');

const seedMarkdownConversation = async (page: import('@playwright/test').Page) => {
  const userFixture = buildVaultFixture('user_e2e', 'e2e@example.com');
  const conversationFixture = buildConversationFixture(
    userFixture,
    'conv_e2e_md',
    'Markdown Showcase',
  );

  const userMessage = buildMessageRecordFixture(conversationFixture, {
    id: 'msg_user_md',
    created: '2026-06-13T22:25:00Z',
    content: 'show me markdown',
    ownerId: userFixture.authState.model.id,
  });
  const assistantMessage = buildMessageRecordFixture(conversationFixture, {
    id: 'msg_assistant_md',
    created: '2026-06-13T22:25:05Z',
    content: markdownContent,
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
    'http://localhost:8090/api/v1/conversations/conv_e2e_md/public-key',
    async (route) => {
      await route.fulfill({ json: conversationFixture.conversationPublicKeyRecord });
    },
  );
  await page.route(
    'http://localhost:8090/api/v1/conversations/conv_e2e_md/secret-key',
    async (route) => {
      await route.fulfill({ json: conversationFixture.conversationSecretKeyRecord });
    },
  );
  await page.route(
    'http://localhost:8090/api/v1/conversations/conv_e2e_md/messages?page=1&page_size=100',
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

const fontSizeOf = async (locator: import('@playwright/test').Locator) =>
  parseFloat(await locator.evaluate((el) => getComputedStyle(el).fontSize));

test('rendered markdown styles headings, lists and tables distinctly', async ({
  page,
}) => {
  await seedMarkdownConversation(page);
  await page.goto('/c/conv_e2e_md');

  const assistant = page.locator('.message-list-item__assistant');
  const h1 = assistant.getByRole('heading', { name: 'Heading One', level: 1 });
  const h2 = assistant.getByRole('heading', { name: 'Heading Two', level: 2 });
  const paragraph = assistant.locator('p').first();
  const list = assistant.locator('ul').first();
  const tableHeaderCell = assistant.locator('table th').first();

  await expect(h2).toBeVisible();

  const [h1Size, h2Size, pSize] = await Promise.all([
    fontSizeOf(h1),
    fontSizeOf(h2),
    fontSizeOf(paragraph),
  ]);

  // Headings should be visibly larger than body text and ranked by level.
  expect(h1Size).toBeGreaterThan(pSize);
  expect(h2Size).toBeGreaterThan(pSize);
  expect(h1Size).toBeGreaterThanOrEqual(h2Size);

  // Headings should be heavier than body weight.
  const h2Weight = await h2.evaluate((el) =>
    parseInt(getComputedStyle(el).fontWeight, 10),
  );
  expect(h2Weight).toBeGreaterThanOrEqual(600);

  // Lists should show markers and be indented.
  const listStyle = await list.evaluate((el) => getComputedStyle(el).listStyleType);
  const listPadding = await list.evaluate((el) =>
    parseFloat(getComputedStyle(el).paddingInlineStart),
  );
  expect(listStyle).not.toBe('none');
  expect(listPadding).toBeGreaterThan(0);

  // Table cells should be bordered.
  const cellBorder = await tableHeaderCell.evaluate((el) =>
    parseFloat(getComputedStyle(el).borderBottomWidth),
  );
  expect(cellBorder).toBeGreaterThan(0);
});

test('rendered markdown parses callouts, task lists and footnotes', async ({
  page,
}) => {
  await seedMarkdownConversation(page);
  await page.goto('/c/conv_e2e_md');

  const assistant = page.locator('.message-list-item__assistant');

  await expect(assistant.getByRole('heading', { name: 'Heading Two' })).toBeVisible();

  // GitHub/Obsidian callout is rendered as a styled alert, not literal text.
  await expect(assistant.locator('.markdown-alert')).toBeVisible();
  await expect(assistant.getByText('[!TIP]')).toHaveCount(0);

  // GFM task list checkboxes are rendered.
  await expect(assistant.locator('li input[type="checkbox"]')).toHaveCount(2);

  // Footnotes are collected into a footnotes section with a back reference.
  await expect(assistant.locator('.footnotes')).toBeVisible();
  await expect(assistant.locator('[data-footnote-ref]').first()).toBeVisible();
});
