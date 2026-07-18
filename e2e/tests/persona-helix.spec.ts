import { type Page, expect, test } from '@playwright/test';
import { execSync } from 'node:child_process';
import { randomBytes, randomUUID } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { newAnonymousApi, provisionApiUser } from './api-helpers';
import {
  authBox,
  generateKeyPair,
  openAuthBox,
  openSealed,
  sealFor,
  utf8,
} from './crypto-helpers';
import {
  pinWorkerHasNoNetworkConsoleOrPersistence,
  pinZipPathTraversalRejectedAtListing,
} from './import-worker-pins';
import { provisionUnlockedAccount } from './persona-helpers';

// PERSONA WALKTHROUGH — Helix (PER-004), browser import Web Worker.
// Helix is not a human Account holder — it is the dedicated worker thread
// that parses hostile Claude/ChatGPT exports locally. These tests pin security
// boundaries (no network I/O, no plaintext persistence, safe ZIP listing),
// friendly error UX (no JSON dumps), cancel/state hygiene, preview progress,
// and the ciphertext-only postMessage → /api/v1/conversation-imports contract.
//
// API atomicity/replay for the same Account lives in conversation-import-api.spec.ts;
// Helix-specific receipt scoping is pinned below where that file has a gap.

const IMPORT_API_PATH = '/api/v1/conversation-imports';
const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';

function clientId(): string {
  const bytes = randomBytes(15);
  return Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join('');
}

function buildClaudeConversation(
  index: number,
  messageCount = 2,
  textPad = 0,
): Record<string, unknown> {
  return {
    uuid: `helix-conv-${index}`,
    name: `Helix synthetic ${index}`,
    created_at: '2026-01-02T10:00:00Z',
    chat_messages: Array.from({ length: messageCount }, (_, messageIndex) => ({
      uuid: `helix-msg-${index}-${messageIndex}`,
      sender: messageIndex % 2 === 0 ? 'human' : 'assistant',
      text: `Helix payload ${index}-${messageIndex}${'x'.repeat(textPad)}`,
      created_at: '2026-01-02T10:00:01Z',
    })),
  };
}

async function gotoImportWizard(page: Page): Promise<void> {
  await page.getByRole('link', { name: 'Bring existing Conversations' }).click();
  await expect(
    page.getByRole('heading', { name: 'Bring your Conversations to Cognos' }),
  ).toBeVisible();
}

function buildChatGptConversation(
  index: number,
  title: string,
  userText: string,
  assistantText: string,
): Record<string, unknown> {
  return {
    id: `helix-chatgpt-${index}`,
    title,
    create_time: 1_700_000_000 + index,
    mapping: {
      root: { parent: null, message: null },
      user: {
        parent: 'root',
        message: {
          author: { role: 'user' },
          content: { content_type: 'text', parts: [userText] },
        },
      },
      assistant: {
        parent: 'user',
        message: {
          author: { role: 'assistant' },
          content: { content_type: 'text', parts: [assistantText] },
        },
      },
    },
  };
}

async function chooseChatGptSource(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'ChatGPT' }).click();
  await expect(
    page.getByRole('heading', { name: 'Export from ChatGPT' }),
  ).toBeVisible();
}

/** Many central-directory entries slow inspectZip enough to exercise Cancel import. */
function buildSlowChatGptZip(conversations: Record<string, unknown>[]): Buffer {
  const dir = mkdtempSync(join(tmpdir(), 'helix-import-'));
  try {
    writeFileSync(join(dir, 'conversations.json'), JSON.stringify(conversations));
    for (let index = 0; index < 200; index += 1) {
      writeFileSync(join(dir, `padding-${index}.txt`), 'x'.repeat(64));
    }
    execSync('zip -r -q slow-export.zip .', { cwd: dir });
    return readFileSync(join(dir, 'slow-export.zip'));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

async function chooseClaudeSource(page: Page): Promise<void> {
  await page.getByRole('button', { name: 'Claude' }).click();
  await expect(page.getByRole('heading', { name: 'Export from Claude' })).toBeVisible();
}

async function uploadClaudeJson(
  page: Page,
  conversations: Record<string, unknown>[],
  fileName = 'claude-export.json',
): Promise<void> {
  await page.getByLabel('Choose your export file').setInputFiles({
    name: fileName,
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(conversations)),
  });
}

function buildImportBody(
  owner: { id: string },
  ownerKeys: ReturnType<typeof generateKeyPair>,
  importId: string,
  marker: string,
) {
  const conversationKeys = generateKeyPair();
  const conversationId = clientId();
  const firstId = clientId();
  const secondId = clientId();
  return {
    import_id: importId,
    source: 'claude' as const,
    conversation: {
      id: conversationId,
      data: authBox(
        conversationKeys.publicKey,
        conversationKeys.secretKey,
        utf8.encode(JSON.stringify({ title: 'Helix receipt isolation' })),
      ),
      public_key: conversationKeys.publicKey,
      public_key_signature: randomBytes(32).toString('base64'),
      wrapped_secret_key: authBox(
        conversationKeys.publicKey,
        ownerKeys.secretKey,
        Buffer.from(conversationKeys.secretKey, 'base64'),
      ),
      expiry_duration: '',
    },
    messages: [
      {
        id: firstId,
        data: sealFor(
          conversationKeys.publicKey,
          utf8.encode(
            JSON.stringify({
              version: '1',
              content: marker,
              conversation_id: conversationId,
              parent_message_id: '',
              owner_id: owner.id,
            }),
          ),
        ),
      },
      {
        id: secondId,
        parent_message: firstId,
        data: sealFor(
          conversationKeys.publicKey,
          utf8.encode(
            JSON.stringify({
              version: '1',
              content: 'Helix assistant line',
              conversation_id: conversationId,
              parent_message_id: firstId,
            }),
          ),
        ),
      },
    ],
    conversationKeys,
    conversationId,
  };
}

test.describe('persona: Helix — import worker (PER-004)', () => {
  test.describe('static security pins', () => {
    test('worker source forbids fetch, console, indexedDB and related APIs', async () => {
      await pinWorkerHasNoNetworkConsoleOrPersistence();
    });

    test('ZIP listing rejects path traversal before inflate', async () => {
      await pinZipPathTraversalRejectedAtListing();
    });
  });

  test.describe('browser import wizard', () => {
    test('malformed JSON shows a friendly reason without dumping raw JSON', async ({
      page,
    }) => {
      const malformed = '{not-valid-json-for-helix-b1946ac9';
      await provisionUnlockedAccount(page);
      await gotoImportWizard(page);
      await chooseClaudeSource(page);

      await page.getByLabel('Choose your export file').setInputFiles({
        name: 'broken-export.json',
        mimeType: 'application/json',
        buffer: Buffer.from(malformed),
      });

      await expect(page.getByText('We could not complete this import.')).toBeVisible();
      await expect(
        page.getByText('The JSON is malformed. Request a new export and try again.'),
      ).toBeVisible();
      await expect(page.locator('body')).not.toContainText(malformed);
      await expect(page.getByText('Review before importing')).not.toBeVisible();
    });

    test('cancel during parse clears wizard state without leaving an error', async ({
      page,
    }) => {
      test.setTimeout(120_000);
      const zipBuffer = buildSlowChatGptZip([
        buildChatGptConversation(
          0,
          'Helix slow zip',
          'Helix cancel probe',
          'Helix cancel reply',
        ),
      ]);

      await provisionUnlockedAccount(page);
      await gotoImportWizard(page);
      await chooseChatGptSource(page);

      await page.getByLabel('Choose your export file').setInputFiles({
        name: 'chatgpt-export.zip',
        mimeType: 'application/zip',
        buffer: zipBuffer,
      });

      const cancelled = await page.evaluate(async () => {
        for (let attempt = 0; attempt < 500; attempt += 1) {
          const button = [...document.querySelectorAll('button')].find((element) =>
            element.textContent?.includes('Cancel import'),
          );
          if (button instanceof HTMLButtonElement && !button.disabled) {
            button.click();
            return true;
          }
          await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        }
        return false;
      });
      expect(
        cancelled,
        'Cancel import should interrupt Helix while the wizard is busy',
      ).toBe(true);

      await expect(page.getByText('Review before importing')).not.toBeVisible();
      await expect(
        page.getByText('We could not complete this import.'),
      ).not.toBeVisible();
      await expect(page.getByLabel('Choose your export file')).toBeEnabled();

      await chooseClaudeSource(page);
      await uploadClaudeJson(page, [buildClaudeConversation(0)]);
      await expect(page.getByText('Helix synthetic 0')).toBeVisible();
    });

    test('multi-conversation export shows preview summary before encrypting', async ({
      page,
    }) => {
      const privateMarker = 'HELIX-MULTI-PREVIEW-MARKER-c0ffee';
      const conversations = [
        {
          ...buildClaudeConversation(1),
          chat_messages: [
            {
              uuid: 'helix-preview-user',
              sender: 'human',
              text: privateMarker,
              created_at: '2026-01-02T10:00:00Z',
            },
          ],
        },
        buildClaudeConversation(2),
      ];

      const requestBodies: string[] = [];
      page.on('request', (request) => {
        const body = request.postData();
        if (body) requestBodies.push(body);
      });

      await provisionUnlockedAccount(page);
      await gotoImportWizard(page);
      await chooseClaudeSource(page);
      await uploadClaudeJson(page, conversations);

      await expect(
        page.getByText('2 Conversations and 3 Messages are ready to review.'),
      ).toBeVisible();
      await expect(page.getByText('Helix synthetic 1')).toBeVisible();
      await expect(page.getByText('Helix synthetic 2')).toBeVisible();
      expect(requestBodies.join('\n')).not.toContain(privateMarker);

      await page.getByRole('button', { name: 'Encrypt and import 2' }).click();
      await expect
        .soft(
          page
            .locator('.conversation-import__progress')
            .filter({ hasText: 'Encrypting and saving the selected Conversations' })
            .first(),
        )
        .toBeVisible({ timeout: 5_000 });
      await expect(page).toHaveURL(/\/c\/[^/]+$/);
    });

    test('unsupported schema shows a friendly reason without worker paths', async ({
      page,
    }) => {
      await provisionUnlockedAccount(page);
      await gotoImportWizard(page);
      await chooseClaudeSource(page);
      await page.getByLabel('Choose your export file').setInputFiles({
        name: 'helix-wrong-schema.json',
        mimeType: 'application/json',
        buffer: Buffer.from(
          JSON.stringify({ anthropic_version: '2099-01', chats: [] }),
        ),
      });

      await expect(page.getByText('We could not complete this import.')).toBeVisible();
      await expect(
        page.getByText(
          'This export format is not supported. Request a current export from the selected source.',
        ),
      ).toBeVisible();
      const bodyText = await page.locator('body').innerText();
      expect(bodyText).not.toMatch(/\b(\.worker\.ts|ImportParseError|stack trace)\b/i);
    });

    test('only ciphertext conversation-import batches reach the API', async ({
      page,
    }) => {
      const privateMarker = 'HELIX-CIPHERTEXT-ONLY-MARKER-deadbee';
      const requestBodies: string[] = [];
      const apiPaths: string[] = [];
      page.on('request', (request) => {
        const body = request.postData();
        if (body) requestBodies.push(body);
        const url = new URL(request.url());
        if (url.pathname.startsWith('/api/')) apiPaths.push(url.pathname);
      });

      await provisionUnlockedAccount(page);
      await gotoImportWizard(page);
      await chooseClaudeSource(page);
      await uploadClaudeJson(page, [
        {
          ...buildClaudeConversation(9),
          chat_messages: [
            {
              uuid: 'helix-ciphertext-user',
              sender: 'human',
              text: privateMarker,
              created_at: '2026-01-02T10:00:00Z',
            },
            {
              uuid: 'helix-ciphertext-assistant',
              sender: 'assistant',
              text: 'Helix imported assistant reply',
              created_at: '2026-01-02T10:00:01Z',
            },
          ],
        },
      ]);

      await expect(page.getByText('Helix synthetic 9')).toBeVisible();
      expect(requestBodies.join('\n')).not.toContain(privateMarker);

      await page.getByRole('button', { name: 'Encrypt and import 1' }).click();
      await expect(page).toHaveURL(/\/c\/[^/]+$/);
      await expect(page.getByText(privateMarker)).toBeVisible();

      expect(requestBodies.join('\n')).not.toContain(privateMarker);
      expect(apiPaths.filter((path) => path === IMPORT_API_PATH)).toHaveLength(1);
      expect(apiPaths.some((path) => path.includes('/complete'))).toBe(false);
    });
  });
});

test.describe('persona: Helix — import API (PER-004)', () => {
  test('requires authentication', async () => {
    const api = await newAnonymousApi();
    try {
      const response = await api.post(IMPORT_API_PATH, { data: {} });
      expect(response.status()).toBe(401);
    } finally {
      await api.dispose();
    }
  });

  test('import_id replay is scoped per Account — same id cannot hijack another import', async () => {
    const owner = await provisionApiUser();
    const outsider = await provisionApiUser();
    const ownerKeys = generateKeyPair();
    const importId = randomUUID().replaceAll('-', '_');
    const ownerMarker = 'HELIX-OWNER-RECEIPT-MARKER-a1b2c3';
    const outsiderMarker = 'HELIX-OUTSIDER-RECEIPT-MARKER-d4e5f6';
    const ownerBody = buildImportBody(owner, ownerKeys, importId, ownerMarker);
    const outsiderKeys = generateKeyPair();
    const outsiderBody = buildImportBody(
      outsider,
      outsiderKeys,
      importId,
      outsiderMarker,
    );

    try {
      const created = await owner.api.post(IMPORT_API_PATH, {
        data: {
          import_id: ownerBody.import_id,
          source: ownerBody.source,
          conversation: ownerBody.conversation,
          messages: ownerBody.messages,
        },
      });
      expect(created.status()).toBe(201);

      const ownerReplay = await owner.api.post(IMPORT_API_PATH, {
        data: {
          import_id: ownerBody.import_id,
          source: ownerBody.source,
          conversation: ownerBody.conversation,
          messages: ownerBody.messages,
        },
      });
      expect(ownerReplay.status()).toBe(200);

      const outsiderImport = await outsider.api.post(IMPORT_API_PATH, {
        data: {
          import_id: outsiderBody.import_id,
          source: outsiderBody.source,
          conversation: outsiderBody.conversation,
          messages: outsiderBody.messages,
        },
      });
      expect(outsiderImport.status()).toBe(201);
      expect(await outsiderImport.json()).not.toEqual(await ownerReplay.json());

      const ownerMessages = await owner.api.get(
        `/api/v1/conversations/${ownerBody.conversationId}/messages?page=1&page_size=10`,
      );
      expect(ownerMessages.ok()).toBe(true);
      const ownerPlaintext = (
        (await ownerMessages.json()) as { items: { data: string }[] }
      ).items.map((record) =>
        JSON.parse(utf8.decode(openSealed(ownerBody.conversationKeys, record.data))),
      );
      expect(ownerPlaintext.map((message) => message.content)).toContain(ownerMarker);
      expect(ownerPlaintext.map((message) => message.content)).not.toContain(
        outsiderMarker,
      );

      const denied = await outsider.api.get(
        `/api/v1/conversations/${ownerBody.conversationId}/messages`,
      );
      expect(denied.status()).toBe(404);

      const outsiderMessages = await outsider.api.get(
        `/api/v1/conversations/${outsiderBody.conversationId}/messages?page=1&page_size=10`,
      );
      expect(outsiderMessages.ok()).toBe(true);
      const outsiderPlaintext = (
        (await outsiderMessages.json()) as { items: { data: string }[] }
      ).items.map((record) =>
        JSON.parse(utf8.decode(openSealed(outsiderBody.conversationKeys, record.data))),
      );
      expect(outsiderPlaintext.map((message) => message.content)).toContain(
        outsiderMarker,
      );

      const digestMismatch = await owner.api.post(IMPORT_API_PATH, {
        data: {
          import_id: ownerBody.import_id,
          source: 'chatgpt',
          conversation: ownerBody.conversation,
          messages: ownerBody.messages,
        },
      });
      expect(digestMismatch.status()).toBe(409);
    } finally {
      await owner.api.dispose();
      await outsider.api.dispose();
    }
  });
});
