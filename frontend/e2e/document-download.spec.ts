import { expect, test } from '@playwright/test';
import { unzipSync } from 'fflate';
import { readFileSync } from 'node:fs';
// Legacy Node build: no DOM/canvas dependency, so text extraction works in the
// Playwright test process without a browser (spec docs/specs/document-generation.md §7).
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';

import {
  ConversationFixture,
  VaultFixture,
  buildConversationFixture,
  buildMessageRecordFixture,
  buildRedactionFixture,
  buildVaultFixture,
  seedAuthenticatedUnlockState,
} from './fixtures';

const API = 'http://localhost:8090';
const CONVERSATION_ID = 'conv_doc_dl';

// Deliberately contains characters (':' and '/') that documentFilename()
// (document-source.ts) must strip/replace before it can be used as a filename.
const CONVERSATION_TITLE = 'Q3 Report: Draft/Ideas';
// FORBIDDEN_FILENAME_CHARS replaces ':' and '/' with '-'; nothing else in this
// title needs sanitising, so this is the exact expected base name.
const SANITISED_TITLE = 'Q3 Report- Draft-Ideas';

// Exercises headings, bold, a link, a table, a nested list, inline code and a
// fenced code block — one document that all three renderers must round-trip.
const MARKDOWN = [
  '# Quarterly Summary',
  '',
  'Revenue grew **12%** in Q3 — see the [plan](https://example.com/plan).',
  '',
  '| Region | Revenue |',
  '| ------ | ------- |',
  '| EMEA   | 42      |',
  '',
  '- First',
  '  - Nested',
  '',
  '`inline code` and a fenced block:',
  '',
  '```ts',
  'const x = 1;',
  '```',
  '',
].join('\n');

const seedConversation = async (
  page: import('@playwright/test').Page,
  options: {
    userFixture?: VaultFixture;
    assistantContent?: string;
    redaction?: ReturnType<typeof buildRedactionFixture>;
  } = {},
): Promise<{ userFixture: VaultFixture; conversationFixture: ConversationFixture }> => {
  const userFixture =
    options.userFixture ?? buildVaultFixture('user_doc_dl', 'docdl@example.com');
  const conversationFixture = buildConversationFixture(
    userFixture,
    CONVERSATION_ID,
    CONVERSATION_TITLE,
  );

  const userMessage = buildMessageRecordFixture(conversationFixture, {
    id: 'msg_user_doc_dl',
    created: '2026-06-20T09:00:00Z',
    content: 'Summarise Q3.',
    ownerId: userFixture.authState.model.id,
  });
  const assistantMessage = buildMessageRecordFixture(conversationFixture, {
    id: 'msg_assistant_doc_dl',
    created: '2026-06-20T09:00:05Z',
    content: options.assistantContent ?? MARKDOWN,
    personaId: 'cognos:simple-assistant',
    modelId: 'eu-model',
    parentMessageId: userMessage.id,
  });

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
    r.fulfill({
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
    }),
  );
  await page.route(`${API}/api/v1/conversations`, (r) =>
    r.fulfill({ json: [conversationFixture.conversationRecord] }),
  );
  await page.route(`${API}/api/v1/conversations/${CONVERSATION_ID}/public-key`, (r) =>
    r.fulfill({ json: conversationFixture.conversationPublicKeyRecord }),
  );
  await page.route(`${API}/api/v1/conversations/${CONVERSATION_ID}/secret-key`, (r) =>
    r.fulfill({ json: conversationFixture.conversationSecretKeyRecord }),
  );
  await page.route(
    `${API}/api/v1/conversations/${CONVERSATION_ID}/messages?page=1&page_size=100`,
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

  if (options.redaction) {
    const redaction = options.redaction;
    await page.route(
      `${API}/api/v1/conversations/${CONVERSATION_ID}/redaction-key`,
      (r) => r.fulfill({ json: redaction.redactionKeyResponse }),
    );
    await page.route(
      `${API}/api/v1/conversations/${CONVERSATION_ID}/redaction-entries`,
      (r) => r.fulfill({ json: redaction.entriesResponse }),
    );
  }

  return { userFixture, conversationFixture };
};

test('shows the download menu on the assistant message only, with the three formats', async ({
  page,
}) => {
  await seedConversation(page);
  await page.goto(`/c/${CONVERSATION_ID}`);

  const assistant = page.locator('.message-list-item__assistant');
  const user = page.locator('.message-list-item__user');
  await expect(assistant.getByText('Quarterly Summary')).toBeVisible();

  // Not offered on the user's own message.
  await user.hover();
  await expect(user.getByRole('button', { name: 'Download' })).toHaveCount(0);

  await assistant.hover();
  const downloadButton = assistant.getByRole('button', { name: 'Download' });
  await expect(downloadButton).toBeVisible();
  await downloadButton.click();

  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('menuitem')).toHaveText([
    'Word document (.docx)',
    'PDF (.pdf)',
    'Markdown (.md)',
  ]);

  // Clicking outside the message closes the menu.
  await page.mouse.click(5, 5);
  await expect(menu).toHaveCount(0);
});

test('downloads Markdown named after the sanitised conversation title', async ({
  page,
}) => {
  await seedConversation(page);
  await page.goto(`/c/${CONVERSATION_ID}`);

  const assistant = page.locator('.message-list-item__assistant');
  await expect(assistant.getByText('Quarterly Summary')).toBeVisible();
  await assistant.hover();
  await assistant.getByRole('button', { name: 'Download' }).click();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Markdown (.md)' }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toBe(`${SANITISED_TITLE}.md`);

  const path = await download.path();
  expect(path).not.toBeNull();
  const contents = readFileSync(path as string, 'utf-8');
  // Markdown "rendering" is a pass-through (renderMarkdownFile) — the
  // downloaded file is exactly the (hydrated) message source.
  expect(contents).toBe(MARKDOWN);
});

test('downloads a Word document with real docx structure', async ({ page }) => {
  await seedConversation(page);
  await page.goto(`/c/${CONVERSATION_ID}`);

  const assistant = page.locator('.message-list-item__assistant');
  await expect(assistant.getByText('Quarterly Summary')).toBeVisible();
  await assistant.hover();
  await assistant.getByRole('button', { name: 'Download' }).click();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Word document (.docx)' }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toBe(`${SANITISED_TITLE}.docx`);

  const path = await download.path();
  expect(path).not.toBeNull();
  const bytes = readFileSync(path as string);
  // A .docx is a zip archive.
  expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK');

  const archive = unzipSync(new Uint8Array(bytes));
  expect(archive['word/styles.xml']).toBeTruthy();

  const documentXml = new TextDecoder().decode(archive['word/document.xml']);
  expect(documentXml).toContain('Quarterly Summary');
  expect(documentXml).toContain('EMEA');
  expect(documentXml).toContain('<w:hyperlink');
  expect(documentXml).toContain('<w:tbl');

  // Metadata hygiene (spec §7): a fixed, non-identifying creator, no email,
  // and timestamps rounded to the day.
  const coreXml = new TextDecoder().decode(archive['docProps/core.xml']);
  expect(coreXml).toContain('<dc:creator>Cognos</dc:creator>');
  expect(coreXml).not.toContain('@');
  const timestamps = [
    ...coreXml.matchAll(/<dcterms:(?:created|modified)[^>]*>([^<]*)</g),
  ].map((match) => match[1]);
  expect(timestamps.length).toBeGreaterThan(0);
  for (const timestamp of timestamps) {
    expect(timestamp.endsWith('T00:00:00Z')).toBe(true);
  }
});

test('downloads a PDF with the rendered message text', async ({ page }) => {
  await seedConversation(page);
  await page.goto(`/c/${CONVERSATION_ID}`);

  const assistant = page.locator('.message-list-item__assistant');
  await expect(assistant.getByText('Quarterly Summary')).toBeVisible();
  await assistant.hover();
  await assistant.getByRole('button', { name: 'Download' }).click();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'PDF (.pdf)' }).click();
  const download = await downloadPromise;

  expect(download.suggestedFilename()).toBe(`${SANITISED_TITLE}.pdf`);

  const path = await download.path();
  expect(path).not.toBeNull();
  const bytes = new Uint8Array(readFileSync(path as string));
  expect(Buffer.from(bytes.subarray(0, 4)).toString('latin1')).toBe('%PDF');

  const loadingTask = pdfjsLib.getDocument({ data: bytes });
  const pdfDoc = await loadingTask.promise;
  const pdfPage = await pdfDoc.getPage(1);
  const textContent = await pdfPage.getTextContent();
  const text = textContent.items
    .map((item) => ('str' in item ? item.str : ''))
    .join(' ');

  expect(text).toContain('Quarterly Summary');
  expect(text).toContain('EMEA');
});

test('downloaded Markdown hydrates redaction placeholders back to originals', async ({
  page,
}) => {
  const IBAN = 'GB82 WEST 1234 5698 7654 32';
  const TOKEN = '[[PII_IBAN_DOCDL1]]';
  const userFixture = buildVaultFixture('user_doc_dl', 'docdl@example.com');
  const redaction = buildRedactionFixture(userFixture, [
    {
      token: TOKEN,
      type: 'iban',
      original: IBAN,
      normalized: 'GB82WEST12345698765432',
      detector: 'iban:v1',
    },
  ]);
  const assistantContent = `Wire the invoice to ${TOKEN} before Friday.`;

  await seedConversation(page, { userFixture, assistantContent, redaction });
  await page.goto(`/c/${CONVERSATION_ID}`);

  const assistant = page.locator('.message-list-item__assistant');
  // The pill hydrates the original once redaction mappings load — wait for it
  // before downloading, exactly like the on-screen bubble.
  await expect(assistant).toContainText(IBAN);

  await assistant.hover();
  await assistant.getByRole('button', { name: 'Download' }).click();

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('menuitem', { name: 'Markdown (.md)' }).click();
  const download = await downloadPromise;

  const path = await download.path();
  expect(path).not.toBeNull();
  const contents = readFileSync(path as string, 'utf-8');

  expect(contents).toContain(IBAN);
  expect(contents).not.toContain(TOKEN);
});
