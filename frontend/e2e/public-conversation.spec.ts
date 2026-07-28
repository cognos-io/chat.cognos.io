import { Browser, Page, expect, test } from '@playwright/test';

import {
  type ConversationFixture,
  type VaultFixture,
  buildConversationFixture,
  buildMessageRecordFixture,
  buildPublicShareFixture,
  buildVaultFixture,
  seedAuthenticatedUnlockState,
} from './fixtures';

const PB = 'http://localhost:8090';

test('public share pages include a noindex robots meta tag', async ({ page }) => {
  // The tag is set as soon as the public route boots — even when the share is
  // unavailable — so we do not need a seeded conversation for this check.
  await page.goto('/p/anytoken');
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    'content',
    'noindex, nofollow',
  );
});

const modelsCatalogue = {
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
      pricing: { input_usd_per_million_tokens: 1, output_usd_per_million_tokens: 2 },
      is_eligible: true,
    },
  ],
};

// Route the unauthenticated public read endpoints for a token: the conversation
// payload and its message list. Mirrors the backend's /api/v1/public surface.
const routePublicEndpoints = async (
  page: Page,
  token: string,
  publicConversationResponse: object,
  messages: object[],
) => {
  await page.route(`${PB}/api/v1/public/conversations/${token}`, async (route) => {
    await route.fulfill({ json: publicConversationResponse });
  });
  await page.route(
    `${PB}/api/v1/public/conversations/${token}/messages`,
    async (route) => {
      await route.fulfill({
        json: {
          page: 1,
          perPage: 100,
          totalItems: messages.length,
          totalPages: 1,
          items: messages,
        },
      });
    },
  );
  await page.route(`${PB}/api/v1/public/models`, async (route) => {
    await route.fulfill({ json: { models: [{ id: 'eu-model', name: 'EU Model' }] } });
  });
};

// Minimal authenticated chat routing so a conversation page loads and the Share
// button is live. Mirrors the seed used by chat-header.spec.ts.
const seedAuthenticatedConversation = async (
  page: Page,
  userFixture: VaultFixture,
  conversation: ConversationFixture,
) => {
  await seedAuthenticatedUnlockState(page, userFixture);
  await page.route(`${PB}/api/v1/user-key-pair`, async (route) =>
    route.fulfill({ json: userFixture.userKeyPairRecord }),
  );
  await page.route(`${PB}/api/v1/vault-session`, async (route) =>
    route.fulfill({ json: userFixture.vaultSession }),
  );
  await page.route(`${PB}/api/v1/user-preferences`, async (route) =>
    route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Not found' }),
    }),
  );
  await page.route(`${PB}/api/v1/models`, async (route) =>
    route.fulfill({ json: modelsCatalogue }),
  );
  await page.route(`${PB}/api/v1/conversations`, async (route) =>
    route.fulfill({ json: [conversation.conversationRecord] }),
  );
  const id = conversation.conversationRecord.id;
  await page.route(`${PB}/api/v1/conversations/${id}/public-key`, async (route) =>
    route.fulfill({ json: conversation.conversationPublicKeyRecord }),
  );
  await page.route(`${PB}/api/v1/conversations/${id}/secret-key`, async (route) =>
    route.fulfill({ json: conversation.conversationSecretKeyRecord }),
  );
  await page.route(
    `${PB}/api/v1/conversations/${id}/messages?page=1&page_size=100`,
    async (route) =>
      route.fulfill({
        json: { page: 1, perPage: 100, totalItems: 0, totalPages: 1, items: [] },
      }),
  );
};

test.use({ viewport: { width: 1280, height: 720 } });

test('renders shared message content as markdown, not raw text', async ({ page }) => {
  const userFixture = buildVaultFixture('user_pub', 'pub@example.com');
  const conversation = buildConversationFixture(
    userFixture,
    'conv_md',
    'Markdown share',
  );
  const share = buildPublicShareFixture(conversation, 'mdtoken00000001');

  const message = buildMessageRecordFixture(conversation, {
    id: 'msg_md',
    created: '2026-06-14T10:00:00Z',
    content: '## Heading\n\nThis is **bold** and `inline code`.\n\n- one\n- two',
  });

  await routePublicEndpoints(page, share.token, share.publicConversationResponse, [
    message,
  ]);

  await page.goto(`/p/${share.token}#${share.fragment}`);

  await expect(page.getByRole('heading', { name: 'Markdown share' })).toBeVisible();

  const messages = page.locator('.public-conversation__messages');
  // Markdown must be rendered to HTML, not shown as literal asterisks/backticks.
  await expect(messages.locator('h2')).toHaveText('Heading');
  await expect(messages.locator('strong')).toHaveText('bold');
  await expect(messages.locator('code')).toHaveText('inline code');
  // Scope the list assertion to the rendered markdown body, not the outer
  // per-message <li> wrappers.
  await expect(messages.locator('.public-conversation__text li')).toHaveCount(2);
  await expect(messages).not.toContainText('**bold**');
});

test('shows a private cue for a user-upload attachment a public viewer cannot decrypt', async ({
  page,
}) => {
  const userFixture = buildVaultFixture('user_priv', 'priv@example.com');
  const conversation = buildConversationFixture(
    userFixture,
    'conv_priv',
    'Private file',
  );
  const share = buildPublicShareFixture(conversation, 'privtoken0000001');

  // A user message that referenced a library file. The file is sealed to the
  // owner's key, so a public reader can never see it — only the cue.
  const message = buildMessageRecordFixture(conversation, {
    id: 'm_priv',
    created: '2026-06-14T10:00:00Z',
    content: "what's my name?",
    ownerId: userFixture.authState.model.id,
    attachments: [
      { kind: 'user_upload', mime_type: 'text/plain', attachment_id: 'lib_file_0001' },
    ],
  });

  await routePublicEndpoints(page, share.token, share.publicConversationResponse, [
    message,
  ]);

  await page.goto(`/p/${share.token}#${share.fragment}`);

  await expect(page.getByRole('heading', { name: 'Private file' })).toBeVisible();
  // The message content still renders; the file shows the private cue, and the
  // viewer is offered no way to fetch or decrypt it.
  await expect(page.getByText("what's my name?")).toBeVisible();
  await expect(page.getByTestId('message-attachment-private')).toBeVisible();
  await expect(page.getByTestId('message-attachment-chip')).toHaveCount(0);
});

test('shows shared assistant reasoning in a collapsed disclosure, separate from the answer', async ({
  page,
}) => {
  const userFixture = buildVaultFixture('user_reason', 'reason@example.com');
  const conversation = buildConversationFixture(
    userFixture,
    'conv_reason',
    'Reasoning share',
  );
  const share = buildPublicShareFixture(conversation, 'reasontoken00001');

  const userMessage = buildMessageRecordFixture(conversation, {
    id: 'm_user_r',
    created: '2026-06-14T10:00:00Z',
    content: 'Why is the sky blue?',
    ownerId: userFixture.authState.model.id,
  });
  const answer = buildMessageRecordFixture(conversation, {
    id: 'm_answer_r',
    created: '2026-06-14T10:00:01Z',
    content: 'Rayleigh scattering.',
    reasoning: 'Weighing scattering versus absorption before answering.',
    parentMessageId: 'm_user_r',
    modelId: 'eu-model',
  });

  await routePublicEndpoints(page, share.token, share.publicConversationResponse, [
    userMessage,
    answer,
  ]);

  await page.goto(`/p/${share.token}#${share.fragment}`);

  await expect(page.getByRole('heading', { name: 'Reasoning share' })).toBeVisible();

  // The reasoning rides in a disclosure that starts collapsed: the final answer
  // is visible, the reasoning text is not until opened.
  const messages = page.locator('.public-conversation__messages');
  await expect(messages).toContainText('Rayleigh scattering.');
  const reasoning = page.locator('.public-conversation__reasoning');
  await expect(reasoning).toBeVisible();
  await expect(reasoning.locator('markdown')).not.toBeVisible();

  await reasoning.locator('summary').click();
  await expect(reasoning).toContainText('Weighing scattering versus absorption');
});

test('renders the branching message tree with the active path and lets readers switch branches', async ({
  page,
}) => {
  const userFixture = buildVaultFixture('user_tree', 'tree@example.com');
  const conversation = buildConversationFixture(userFixture, 'conv_tree', 'Branching');
  const share = buildPublicShareFixture(conversation, 'treetoken0000001');

  // One user message with two assistant replies (siblings off the same parent).
  const userMessage = buildMessageRecordFixture(conversation, {
    id: 'm_user',
    created: '2026-06-14T10:00:00Z',
    content: 'What is the capital?',
    ownerId: userFixture.authState.model.id,
  });
  const answerOne = buildMessageRecordFixture(conversation, {
    id: 'm_answer_1',
    created: '2026-06-14T10:00:01Z',
    content: 'First answer',
    parentMessageId: 'm_user',
    modelId: 'eu-model',
  });
  const answerTwo = buildMessageRecordFixture(conversation, {
    id: 'm_answer_2',
    created: '2026-06-14T10:00:02Z',
    content: 'Second answer',
    parentMessageId: 'm_user',
    modelId: 'eu-model',
  });

  await routePublicEndpoints(page, share.token, share.publicConversationResponse, [
    userMessage,
    answerOne,
    answerTwo,
  ]);

  await page.goto(`/p/${share.token}#${share.fragment}`);

  await expect(page.getByRole('heading', { name: 'Branching' })).toBeVisible();

  // Active path defaults to the newest sibling, so the user question and the
  // SECOND answer show; the first answer is off the active branch.
  await expect(page.getByText('What is the capital?')).toBeVisible();
  await expect(page.getByText('Second answer')).toBeVisible();
  await expect(page.getByText('First answer')).toBeHidden();

  // Assistant messages are labelled with the model name, not the raw id.
  await expect(page.getByText('EU Model')).toBeVisible();
  await expect(page.locator('.public-conversation').getByText('eu-model')).toHaveCount(
    0,
  );

  // Ordering: the user question precedes the assistant reply in the DOM.
  const messageText = await page.locator('.public-conversation__messages').innerText();
  expect(messageText.indexOf('What is the capital?')).toBeLessThan(
    messageText.indexOf('Second answer'),
  );

  // The parent message carries the branch-point tick (⑂ 2 → title "2 versions").
  await expect(page.getByTitle('2 versions')).toBeVisible();

  // The forked reply shows the ‹ index / count › switcher.
  const switcher = page.getByRole('group', { name: 'Switch response' });
  await expect(switcher).toContainText('2 / 2');

  // Stepping back swaps the active branch to the first answer.
  await page.getByRole('button', { name: 'Previous response' }).click();
  await expect(page.getByText('First answer')).toBeVisible();
  await expect(page.getByText('Second answer')).toBeHidden();
  await expect(switcher).toContainText('1 / 2');
});

test('owner shares from the chat, copies the link, and an unauthenticated visitor reads it', async ({
  page,
  browser,
}: {
  page: Page;
  browser: Browser;
}) => {
  const userFixture = buildVaultFixture('user_flow', 'flow@example.com');
  const conversation = buildConversationFixture(userFixture, 'conv_flow', 'Flow share');

  await seedAuthenticatedConversation(page, userFixture, conversation);

  // The dialog first checks for an existing share (none), then POSTs to create
  // one. Capture the client-computed crypto so the public endpoints can echo
  // the wrapped secret back to the anonymous reader.
  let captured: { wrapped_conversation_secret_key: string } | null = null;
  const token = 'flowtoken0000001';
  await page.route(
    `${PB}/api/v1/conversations/${conversation.conversationRecord.id}/public-share`,
    async (route) => {
      if (route.request().method() === 'GET') {
        await route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: JSON.stringify({ message: 'not shared' }),
        });
        return;
      }
      captured = route.request().postDataJSON();
      await route.fulfill({ json: { token, key_version: 1 } });
    },
  );

  await page.goto(`/c/${conversation.conversationRecord.id}`);
  await page.getByRole('button', { name: 'Share' }).click();
  await page.getByRole('button', { name: 'Create public link' }).click();

  const shareUrl = await page.getByLabel('Public share link').inputValue();
  expect(shareUrl).toContain(`/p/${token}#`);
  expect(captured).not.toBeNull();

  // An unauthenticated visitor (fresh context, no auth storage) opens the link.
  const visitorContext = await browser.newContext();
  const visitor = await visitorContext.newPage();

  const message = buildMessageRecordFixture(conversation, {
    id: 'm_flow',
    created: '2026-06-14T10:00:00Z',
    content: 'Shared **markdown** body',
    ownerId: userFixture.authState.model.id,
  });

  await routePublicEndpoints(
    visitor,
    token,
    {
      conversation_id: conversation.conversationRecord.id,
      data: conversation.conversationRecord.data,
      conversation_public_key: conversation.conversationPublicKeyRecord.public_key,
      wrapped_conversation_secret_key: captured!.wrapped_conversation_secret_key,
      key_version: 1,
    },
    [message],
  );

  await visitor.goto(shareUrl);

  await expect(visitor.getByRole('heading', { name: 'Flow share' })).toBeVisible();
  await expect(visitor.locator('.public-conversation__messages strong')).toHaveText(
    'markdown',
  );

  await visitorContext.close();
});
