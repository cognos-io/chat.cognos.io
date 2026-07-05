import { type Page, expect, test } from '@playwright/test';
import { unzipSync } from 'fflate';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';

import {
  ConversationFixture,
  VaultFixture,
  buildConversationFixture,
  buildMessageRecordFixture,
  buildVaultFixture,
  seedAuthenticatedUnlockState,
} from './fixtures';

// Phase 2 model-created documents (spec docs/specs/document-generation.md
// §5.2/§6/§16): the stream parser turning a `<cog-doc>` block into a document
// card while it streams, the completed card's download, fail-open behaviour on
// truncated/invalid blocks, the composer opt-out's effect on the wire, and
// re-render from persisted (encrypted) history. Phase 1's "Download as…" path
// is covered separately in document-download.spec.ts.

const API = 'http://localhost:8090';

const corsHeaders = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET,POST,PUT,PATCH,DELETE,OPTIONS',
  'access-control-allow-headers': 'Authorization, Content-Type',
};

const usageFixture = {
  input_tokens: 12,
  output_tokens: 8,
  total_tokens: 20,
  cache_creation_input_tokens: 0,
  cache_read_input_tokens: 0,
  cost_usd: 0.02,
  cost_chf: 0.02,
  cost_rappen: 2,
  used_provider_cost: true,
};

const modelsResponse = () => ({
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
});

// seedBaseRoutes wires up every route a conversation page needs *except*
// messages/complete, which vary per test (empty for a live send, seeded for a
// history/reload test).
const seedBaseRoutes = async (
  page: Page,
  userFixture: VaultFixture,
  conversationFixture: ConversationFixture,
): Promise<void> => {
  await seedAuthenticatedUnlockState(page, userFixture);
  await page.route(`${API}/api/v1/user-key-pair`, (r) =>
    r.fulfill({ json: userFixture.userKeyPairRecord }),
  );
  await page.route(`${API}/api/v1/vault-session`, (r) =>
    r.fulfill({ json: userFixture.vaultSession }),
  );
  await page.route(`${API}/api/v1/user-preferences`, (r) =>
    r.fulfill({ status: 404, contentType: 'application/json', body: '{}' }),
  );
  await page.route(`${API}/api/v1/models`, (r) =>
    r.fulfill({ json: modelsResponse() }),
  );
  await page.route(`${API}/api/v1/conversations`, (r) =>
    r.fulfill({ json: [conversationFixture.conversationRecord] }),
  );
  await page.route(
    `${API}/api/v1/conversations/${conversationFixture.conversationRecord.id}/public-key`,
    (r) => r.fulfill({ json: conversationFixture.conversationPublicKeyRecord }),
  );
  await page.route(
    `${API}/api/v1/conversations/${conversationFixture.conversationRecord.id}/secret-key`,
    (r) => r.fulfill({ json: conversationFixture.conversationSecretKeyRecord }),
  );
};

const seedEmptyMessages = (page: Page, conversationId: string) =>
  page.route(
    `${API}/api/v1/conversations/${conversationId}/messages?page=1&page_size=100`,
    (r) =>
      r.fulfill({
        json: { page: 1, perPage: 100, totalItems: 0, totalPages: 1, items: [] },
      }),
  );

const composerLabel =
  'Message Cognos — stored encrypted; sent to your provider to reply';

// The reply fixture from spec §6.1's own example: prose, a `<cog-doc>` block
// (docx, titled, with a page-number footer) containing a heading, a paragraph
// and a table, then trailing prose. Reused across every test below.
const PROSE_BEFORE = 'Here is your report.';
const DOC_SPEC_JSON =
  '{"v":1,"format":"docx","title":"Board Brief","filename":"board-brief","footer":{"pageNumbers":true}}';
const DOC_BODY = [
  '# Board Brief',
  '',
  'Prepared for the quarterly review.',
  '',
  '| Item | Status |',
  '| ---- | ------ |',
  '| Revenue | Up |',
].join('\n');
const PROSE_AFTER = 'Anything else?';
const OPEN_TAG = `<cog-doc spec='${DOC_SPEC_JSON}'>`;
const FULL_CONTENT = `${PROSE_BEFORE}\n\n${OPEN_TAG}\n${DOC_BODY}\n</cog-doc>\n\n${PROSE_AFTER}`;

// Split point for the genuinely-chunked streaming test: partway through the
// table row, so the block is still open (no closing tag yet) in the first
// chunk. Derived from FULL_CONTENT itself so the two halves always concatenate
// back to it exactly.
const STREAM_SPLIT_MARKER = '| Revenue ';
const splitIndex =
  FULL_CONTENT.indexOf(STREAM_SPLIT_MARKER) + STREAM_SPLIT_MARKER.length;
const STREAM_CHUNK_1 = FULL_CONTENT.slice(0, splitIndex);
const STREAM_CHUNK_2 = FULL_CONTENT.slice(splitIndex);

test('a document card appears mid-stream, titled from the spec, before the block closes', async ({
  page,
}) => {
  // This is a genuine chunked-SSE test, not a load-fixture substitute: a real
  // HTTP server streams two `delta` frames with a pause between them (same
  // technique as messages-streaming.spec.ts), so the assertions below observe
  // the app's actual mid-stream DOM state, not a simulated one.
  const userFixture = buildVaultFixture(
    'user_doc_card_stream',
    'doccard-stream@example.com',
  );
  const conversationFixture = buildConversationFixture(
    userFixture,
    'conv_doc_card_stream',
    'Document streaming',
  );

  const server = createServer((request, response) => {
    if (request.method === 'OPTIONS') {
      response.writeHead(204, corsHeaders);
      response.end();
      return;
    }

    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    if (request.method !== 'POST' || url.pathname !== '/stream') {
      response.writeHead(404, { ...corsHeaders, 'content-type': 'application/json' });
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

    response.write(
      `data: ${JSON.stringify({ type: 'delta', delta: STREAM_CHUNK_1 })}\n\n`,
    );

    setTimeout(() => {
      response.write(
        `data: ${JSON.stringify({ type: 'delta', delta: STREAM_CHUNK_2 })}\n\n`,
      );

      setTimeout(() => {
        response.end(
          `data: ${JSON.stringify({
            type: 'complete',
            response: {
              user_message_id: 'msg_user_doc_stream',
              assistant_message: {
                id: 'msg_assistant_doc_stream',
                parent_message_id: 'msg_user_doc_stream',
                content: FULL_CONTENT,
                persona_id: 'cognos:simple-assistant',
                model_id: 'eu-model',
                created_at: '2026-06-20T00:00:00Z',
              },
              usage: usageFixture,
            },
          })}\n\n`,
        );
      }, 900);
    }, 900);
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
    await seedBaseRoutes(page, userFixture, conversationFixture);
    await seedEmptyMessages(page, 'conv_doc_card_stream');
    await page.route(
      `${API}/api/v1/conversations/conv_doc_card_stream/complete`,
      (route) => route.continue({ url: `http://127.0.0.1:${address.port}/stream` }),
    );

    await page.goto('/c/conv_doc_card_stream');
    await expect(
      page.getByRole('heading', { name: 'Document streaming' }),
    ).toBeVisible();
    await expect(page.getByRole('button', { name: 'EU Model' })).toBeVisible();

    const composer = page.getByLabel(composerLabel);
    await composer.fill('Write me a board brief');
    await page.getByRole('button', { name: 'Send' }).click();

    // Prose ahead of the block is visible immediately, same as plain text.
    await expect(page.getByText(PROSE_BEFORE)).toBeVisible();

    // The card shows up while the block is still open: titled from the spec,
    // in the "Creating…" state, with no Download button yet.
    const card = page.locator('.document-card');
    await expect(card.getByText('Board Brief')).toBeVisible();
    await expect(card.getByText('Creating document…')).toBeVisible();
    await expect(card.getByRole('button', { name: 'Download' })).toHaveCount(0);

    // Once the closing tag arrives the card flips to ready.
    await expect(card.getByRole('button', { name: 'Download' })).toBeVisible();
    await expect(page.getByText(PROSE_AFTER)).toBeVisible();
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
});

test('a completed document card shows title, format and prose either side, and downloads a real docx', async ({
  page,
}) => {
  const userFixture = buildVaultFixture(
    'user_doc_card_ready',
    'doccard-ready@example.com',
  );
  const conversationFixture = buildConversationFixture(
    userFixture,
    'conv_doc_card_ready',
    'Document ready',
  );

  await seedBaseRoutes(page, userFixture, conversationFixture);
  await seedEmptyMessages(page, 'conv_doc_card_ready');
  await page.route(
    `${API}/api/v1/conversations/conv_doc_card_ready/complete`,
    (route) =>
      route.fulfill({
        contentType: 'text/event-stream',
        body: [
          `data: ${JSON.stringify({ type: 'delta', delta: FULL_CONTENT })}`,
          '',
          `data: ${JSON.stringify({
            type: 'complete',
            response: {
              user_message_id: 'msg_user_doc_ready',
              assistant_message: {
                id: 'msg_assistant_doc_ready',
                parent_message_id: 'msg_user_doc_ready',
                content: FULL_CONTENT,
                persona_id: 'cognos:simple-assistant',
                model_id: 'eu-model',
                created_at: '2026-06-20T00:00:00Z',
              },
              usage: usageFixture,
            },
          })}`,
          '',
        ].join('\n'),
      }),
  );

  await page.goto('/c/conv_doc_card_ready');
  await expect(page.getByRole('heading', { name: 'Document ready' })).toBeVisible();

  const composer = page.getByLabel(composerLabel);
  await composer.fill('Write me a board brief');
  await page.getByRole('button', { name: 'Send' }).click();

  const assistant = page.locator('.message-list-item__assistant');
  await expect(assistant.getByText(PROSE_BEFORE)).toBeVisible();
  await expect(assistant.getByText(PROSE_AFTER)).toBeVisible();

  const card = assistant.locator('.document-card');
  await expect(card.getByText('Board Brief')).toBeVisible();
  await expect(card.getByText('DOCX')).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await card.getByRole('button', { name: 'Download' }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toBe('board-brief.docx');

  const path = await download.path();
  expect(path).not.toBeNull();
  const bytes = readFileSync(path as string);
  expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK');

  const archive = unzipSync(new Uint8Array(bytes));
  const documentXml = new TextDecoder().decode(archive['word/document.xml']);
  expect(documentXml).toContain('Board Brief');
  expect(documentXml).toContain('Revenue');

  // footer.pageNumbers was requested in the spec, so a footer part must exist
  // and carry the PAGE field code docx emits for PageNumber.CURRENT.
  expect(archive['word/footer1.xml']).toBeTruthy();
  const footerXml = new TextDecoder().decode(archive['word/footer1.xml']);
  expect(footerXml).toContain('PAGE');

  // Renderer metadata hygiene (spec §7): a fixed, non-identifying creator.
  const coreXml = new TextDecoder().decode(archive['docProps/core.xml']);
  expect(coreXml).toContain('<dc:creator>Cognos</dc:creator>');
});

test('an unterminated persisted block fails open to plain markdown with no note', async ({
  page,
}) => {
  const userFixture = buildVaultFixture(
    'user_doc_card_truncated',
    'doccard-truncated@example.com',
  );
  const conversationFixture = buildConversationFixture(
    userFixture,
    'conv_doc_card_truncated',
    'Document truncated',
  );

  // Simulates a stream that stopped (max_output_tokens) before the closing
  // tag ever arrived — a persisted, non-streaming message, so the parser's
  // fail-open rule (spec §6.2) applies: the whole thing renders as plain
  // markdown, no card, no note.
  const truncatedContent = [
    PROSE_BEFORE,
    '',
    `<cog-doc spec='{"format":"docx","title":"Board Brief"}'>`,
    'Prepared for the quarterly review, but the file got cut off before it finished.',
  ].join('\n');

  const userMessage = buildMessageRecordFixture(conversationFixture, {
    id: 'msg_user_doc_truncated',
    created: '2026-06-20T09:00:00Z',
    content: 'Give me the board brief.',
    ownerId: userFixture.authState.model.id,
  });
  const assistantMessage = buildMessageRecordFixture(conversationFixture, {
    id: 'msg_assistant_doc_truncated',
    created: '2026-06-20T09:00:05Z',
    content: truncatedContent,
    personaId: 'cognos:simple-assistant',
    modelId: 'eu-model',
    parentMessageId: userMessage.id,
  });

  await seedBaseRoutes(page, userFixture, conversationFixture);
  await page.route(
    `${API}/api/v1/conversations/conv_doc_card_truncated/messages?page=1&page_size=100`,
    (r) =>
      r.fulfill({
        json: {
          page: 1,
          perPage: 100,
          totalItems: 2,
          totalPages: 1,
          items: [userMessage, assistantMessage],
        },
      }),
  );

  await page.goto('/c/conv_doc_card_truncated');

  const assistant = page.locator('.message-list-item__assistant');
  await expect(assistant.getByText(PROSE_BEFORE)).toBeVisible();
  await expect(
    assistant.getByText('Prepared for the quarterly review, but the file got cut off'),
  ).toBeVisible();

  await expect(page.locator('.document-card')).toHaveCount(0);
  await expect(
    assistant.getByText("Couldn't build this file — showing its content instead."),
  ).toHaveCount(0);
});

test('a closed block with an invalid spec fails open with the documentInvalid note', async ({
  page,
}) => {
  const userFixture = buildVaultFixture(
    'user_doc_card_invalid',
    'doccard-invalid@example.com',
  );
  const conversationFixture = buildConversationFixture(
    userFixture,
    'conv_doc_card_invalid',
    'Document invalid',
  );

  // "pptx" isn't in the v1 format enum (docx | pdf), so the spec attribute
  // fails zod validation → spec is null → the closed block is 'invalid', not
  // 'ready' — fails open to raw content + a translated note (spec §5.2).
  const invalidContent = [
    PROSE_BEFORE,
    '',
    `<cog-doc spec='{"format":"pptx","title":"Slide Deck"}'>`,
    'Body content that should stay visible.',
    '</cog-doc>',
    '',
    PROSE_AFTER,
  ].join('\n');

  const userMessage = buildMessageRecordFixture(conversationFixture, {
    id: 'msg_user_doc_invalid',
    created: '2026-06-20T09:00:00Z',
    content: 'Give me a slide deck.',
    ownerId: userFixture.authState.model.id,
  });
  const assistantMessage = buildMessageRecordFixture(conversationFixture, {
    id: 'msg_assistant_doc_invalid',
    created: '2026-06-20T09:00:05Z',
    content: invalidContent,
    personaId: 'cognos:simple-assistant',
    modelId: 'eu-model',
    parentMessageId: userMessage.id,
  });

  await seedBaseRoutes(page, userFixture, conversationFixture);
  await page.route(
    `${API}/api/v1/conversations/conv_doc_card_invalid/messages?page=1&page_size=100`,
    (r) =>
      r.fulfill({
        json: {
          page: 1,
          perPage: 100,
          totalItems: 2,
          totalPages: 1,
          items: [userMessage, assistantMessage],
        },
      }),
  );

  await page.goto('/c/conv_doc_card_invalid');

  const assistant = page.locator('.message-list-item__assistant');
  await expect(assistant.getByText(PROSE_BEFORE)).toBeVisible();
  await expect(
    assistant.getByText('Body content that should stay visible.'),
  ).toBeVisible();
  await expect(
    assistant.getByText("Couldn't build this file — showing its content instead."),
  ).toBeVisible();
  await expect(assistant.getByText(PROSE_AFTER)).toBeVisible();

  // Fails open to markdown, not a card.
  await expect(page.locator('.document-card')).toHaveCount(0);
});

test('the "Create documents" toggle controls whether the cog-doc contract reaches the completion request', async ({
  page,
}) => {
  const userFixture = buildVaultFixture(
    'user_doc_card_optout',
    'doccard-optout@example.com',
  );
  const conversationFixture = buildConversationFixture(
    userFixture,
    'conv_doc_card_optout',
    'Document opt-out',
  );

  await seedBaseRoutes(page, userFixture, conversationFixture);
  await seedEmptyMessages(page, 'conv_doc_card_optout');

  const requestBodies: string[] = [];
  let turn = 0;
  await page.route(
    `${API}/api/v1/conversations/conv_doc_card_optout/complete`,
    (route) => {
      turn += 1;
      requestBodies.push(route.request().postData() ?? '');
      const label = `Reply ${turn}`;
      return route.fulfill({
        contentType: 'text/event-stream',
        body: [
          `data: ${JSON.stringify({ type: 'delta', delta: label })}`,
          '',
          `data: ${JSON.stringify({
            type: 'complete',
            response: {
              user_message_id: `msg_user_optout_${turn}`,
              assistant_message: {
                id: `msg_assistant_optout_${turn}`,
                parent_message_id: `msg_user_optout_${turn}`,
                content: label,
                persona_id: 'cognos:simple-assistant',
                model_id: 'eu-model',
                created_at: '2026-06-20T00:00:00Z',
              },
              usage: usageFixture,
            },
          })}`,
          '',
        ].join('\n'),
      });
    },
  );

  await page.goto('/c/conv_doc_card_optout');
  await expect(page.getByRole('heading', { name: 'Document opt-out' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'EU Model' })).toBeVisible();

  const composer = page.getByLabel(composerLabel);

  // 1. "Create documents" is on by default (spec Decision 8): the contract
  // reaches the system prompt without the user touching anything.
  await composer.fill('First message');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('Reply 1')).toBeVisible();

  expect(requestBodies).toHaveLength(1);
  expect(requestBodies[0]).toContain('<cog-doc');

  // 2. Opt out for this conversation via the composer Tools menu, mirroring
  // web-search mechanics.
  await page.getByRole('button', { name: 'Tools' }).click();
  await page.getByRole('switch', { name: 'Create documents' }).click();
  // Dismiss the overlay the same way message-actions menus are closed
  // elsewhere in this suite: a click outside triggers the CDK backdrop.
  await page.mouse.click(5, 5);

  await composer.fill('Second message');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('Reply 2')).toBeVisible();

  expect(requestBodies).toHaveLength(2);
  // Not just "no opening tag" — no trace of the feature anywhere on the wire,
  // matching a pre-feature client's request (spec §16 API e2e: "byte-identical
  // … only the system prompt differs" — and here it doesn't differ at all).
  expect(requestBodies[1]).not.toContain('cog-doc');
});

test('reload renders a document card from persisted (encrypted) history, with working download', async ({
  page,
}) => {
  const userFixture = buildVaultFixture(
    'user_doc_card_reload',
    'doccard-reload@example.com',
  );
  const conversationFixture = buildConversationFixture(
    userFixture,
    'conv_doc_card_reload',
    'Document reload',
  );

  const userMessage = buildMessageRecordFixture(conversationFixture, {
    id: 'msg_user_doc_reload',
    created: '2026-06-20T09:00:00Z',
    content: 'Give me the board brief.',
    ownerId: userFixture.authState.model.id,
  });
  const assistantMessage = buildMessageRecordFixture(conversationFixture, {
    id: 'msg_assistant_doc_reload',
    created: '2026-06-20T09:00:05Z',
    content: FULL_CONTENT,
    personaId: 'cognos:simple-assistant',
    modelId: 'eu-model',
    parentMessageId: userMessage.id,
  });

  await seedBaseRoutes(page, userFixture, conversationFixture);
  await page.route(
    `${API}/api/v1/conversations/conv_doc_card_reload/messages?page=1&page_size=100`,
    (r) =>
      r.fulfill({
        json: {
          page: 1,
          perPage: 100,
          totalItems: 2,
          totalPages: 1,
          items: [userMessage, assistantMessage],
        },
      }),
  );

  await page.goto('/c/conv_doc_card_reload');

  const assistant = page.locator('.message-list-item__assistant');
  await expect(assistant.getByText(PROSE_BEFORE)).toBeVisible();
  await expect(assistant.getByText(PROSE_AFTER)).toBeVisible();

  const card = assistant.locator('.document-card');
  await expect(card.getByText('Board Brief')).toBeVisible();
  await expect(card.getByText('DOCX')).toBeVisible();

  const downloadPromise = page.waitForEvent('download');
  await card.getByRole('button', { name: 'Download' }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toBe('board-brief.docx');

  const path = await download.path();
  expect(path).not.toBeNull();
  const bytes = readFileSync(path as string);
  expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK');

  const archive = unzipSync(new Uint8Array(bytes));
  const documentXml = new TextDecoder().decode(archive['word/document.xml']);
  expect(documentXml).toContain('Board Brief');
  expect(documentXml).toContain('Revenue');
});
