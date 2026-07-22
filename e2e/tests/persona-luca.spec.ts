import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  composer,
  expectNoRawI18nKeys,
  makeShooter,
  provisionUnlockedAccount,
} from './persona-helpers';

// PERSONA WALKTHROUGH — Luca Ferretti (PER-003), privacy upgrader.
// Luca imports ~400 Claude Conversations client-side, needs preview tallies
// (including unsupported attachment counts) before confirm, ciphertext-only
// uploads, and a working follow-up Completion on an imported Conversation.
// Schema-change failures must stay human-readable — never a stack trace.

const PRIVATE_MARKER = 'LUCA-PER-003-PRIVATE-MARKER-a7c3e91f';

function buildLucaClaudeExport(): string {
  return JSON.stringify([
    {
      uuid: 'luca-conv-research',
      name: 'Client research — Q1 synthesis',
      created_at: '2026-01-02T10:00:00Z',
      chat_messages: [
        {
          uuid: 'luca-research-user',
          sender: 'human',
          text: PRIVATE_MARKER,
          created_at: '2026-01-02T10:00:00Z',
        },
        {
          uuid: 'luca-research-assistant',
          sender: 'assistant',
          text: 'Imported research summary',
          created_at: '2026-01-02T10:00:01Z',
        },
      ],
    },
    {
      uuid: 'luca-conv-workshop',
      name: 'Workshop notes — usability',
      created_at: '2026-01-03T11:00:00Z',
      chat_messages: [
        {
          uuid: 'luca-workshop-user',
          sender: 'human',
          text: 'Usability test observations',
          created_at: '2026-01-03T11:00:00Z',
        },
        {
          uuid: 'luca-workshop-assistant',
          sender: 'assistant',
          text: 'Workshop follow-up themes',
          created_at: '2026-01-03T11:00:01Z',
        },
        {
          uuid: 'luca-workshop-user-2',
          sender: 'human',
          text: 'Add heuristics checklist',
          created_at: '2026-01-03T11:00:02Z',
        },
      ],
    },
    {
      uuid: 'luca-conv-pdf',
      name: 'PDF review session',
      created_at: '2026-01-04T09:00:00Z',
      chat_messages: [
        {
          uuid: 'luca-pdf-user',
          sender: 'human',
          text: 'Review the attached brief',
          attachments: [{ file_name: 'client-brief.pdf' }],
          created_at: '2026-01-04T09:00:00Z',
        },
        {
          uuid: 'luca-pdf-assistant',
          sender: 'assistant',
          text: 'Brief summary without the PDF',
          created_at: '2026-01-04T09:00:01Z',
        },
      ],
    },
  ]);
}

function assertNoPlaintext(requestBodies: string[], marker: string): void {
  expect(requestBodies.join('\n')).not.toContain(marker);
}

test.describe('persona walkthrough: Luca — privacy upgrader / Claude import', () => {
  test('preview tallies → subset encrypt → follow-up; schema errors stay human', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    const shot = makeShooter(page, 'luca');
    const requestBodies: string[] = [];
    const apiPaths: string[] = [];

    page.on('request', (request) => {
      const body = request.postData();
      if (body) requestBodies.push(body);
      const url = new URL(request.url());
      if (url.pathname.startsWith('/api/')) apiPaths.push(url.pathname);
    });

    await test.step('signup + vault setup', async () => {
      await provisionUnlockedAccount(page);
      await shot('signed-up-home');
    });

    await test.step('open import wizard via adoption link', async () => {
      await page.getByRole('link', { name: 'Bring existing Conversations' }).click();
      await expect(
        page.getByRole('heading', { name: 'Bring your Conversations to Cognos' }),
      ).toBeVisible();
      await expectNoRawI18nKeys(page, 'import landing');
      await shot('import-wizard-landing');
    });

    await test.step('select Claude → export instructions visible', async () => {
      await page.getByRole('button', { name: 'Claude' }).click();
      await expect(
        page.getByRole('heading', { name: 'Export from Claude' }),
      ).toBeVisible();
      await expect(page.getByText('Choose Export data.')).toBeVisible();
      await expect(
        page.getByRole('link', { name: 'Open the official export guide' }),
      ).toBeVisible();
      await expect(
        page.getByText(
          'ZIP or JSON, up to 250 MB. Attachments, images and tool records are reported but not imported in this version.',
        ),
      ).toBeVisible();
      await shot('claude-export-instructions');
    });

    await test.step('upload synthetic Claude export → preview tallies, no plaintext on wire', async () => {
      await page.getByLabel('Choose your export file').setInputFiles({
        name: 'luca-claude-export.json',
        mimeType: 'application/json',
        buffer: Buffer.from(buildLucaClaudeExport()),
      });

      await expect(
        page.getByRole('heading', { name: 'Review before importing' }),
      ).toBeVisible();
      await expect(
        page.getByText('3 Conversations and 7 Messages are ready to review.'),
      ).toBeVisible();

      // Friction #2: attachment exclusion must be visible before confirm.
      await expect(
        page.getByText(
          'Not imported: 1 attachments, 0 images, 0 tool records and 0 other items.',
        ),
      ).toBeVisible();

      await expect(page.getByText('Client research — Q1 synthesis')).toBeVisible();
      await expect(page.getByText('Workshop notes — usability')).toBeVisible();
      await expect(page.getByText('PDF review session')).toBeVisible();
      await expect(page.getByText('2 Messages').first()).toBeVisible();
      await expect(page.getByText('3 Messages')).toBeVisible();

      assertNoPlaintext(requestBodies, PRIVATE_MARKER);
      await expectNoRawI18nKeys(page, 'import preview');
      await shot('import-preview-tallies');
    });

    await test.step('select subset → encrypt and import 2 Conversations', async () => {
      const workshop = page
        .locator('label')
        .filter({ hasText: 'Workshop notes — usability' });
      await workshop.getByRole('checkbox').uncheck();
      await expect(
        page.getByRole('button', { name: 'Encrypt and import 2' }),
      ).toBeVisible();

      await page.getByRole('button', { name: 'Encrypt and import 2' }).click();
      await expect(page).toHaveURL(/\/c\/[^/]+$/, { timeout: 30_000 });

      assertNoPlaintext(requestBodies, PRIVATE_MARKER);
      expect(apiPaths).toContain('/api/v1/conversation-imports');
      expect(apiPaths.some((path) => path.includes('/complete'))).toBe(false);
      await shot('imported-conversation-open');
    });

    await test.step('imported Conversation decrypts; follow-up Completion works', async () => {
      await expect(page.getByText(PRIVATE_MARKER)).toBeVisible();
      await expect(page.getByText('Imported research summary')).toBeVisible();

      await composer(page).fill('Monday follow-up on the Q1 synthesis');
      await page.getByRole('button', { name: /^send$/i }).click();
      await expect(page.getByText('Mocked assistant reply')).toBeVisible();

      // Import-phase bodies were already checked; completions send thread history
      // to the provider in readable form during the request (by design).
      await expectNoRawI18nKeys(page, 'imported conversation follow-up');
      await shot('imported-follow-up-completion');
    });

    await test.step('malformed / unsupported export shows user-friendly error, not a stack trace', async () => {
      await page.goto('/import');
      await page.getByRole('button', { name: 'Claude' }).click();

      await page.getByLabel('Choose your export file').setInputFiles({
        name: 'broken-export.json',
        mimeType: 'application/json',
        buffer: Buffer.from('{ this is not valid claude export json'),
      });
      await expect(page.getByText('We could not complete this import.')).toBeVisible();
      await expect(
        page.getByText('The JSON is malformed. Request a new export and try again.'),
      ).toBeVisible();

      const bodyAfterMalformed = await page.locator('body').innerText();
      expect(bodyAfterMalformed).not.toMatch(
        /\b(SyntaxError|ImportParseError|stack trace| at Object\.|\.worker\.ts)\b/i,
      );
      await shot('import-malformed-json-error');

      await page.getByLabel('Choose your export file').setInputFiles({
        name: 'wrong-schema.json',
        mimeType: 'application/json',
        buffer: Buffer.from(
          JSON.stringify({ anthropic_version: '2024-99', chats: [] }),
        ),
      });
      await expect(
        page.getByText(
          'This export format is not supported. Request a current export from the selected source.',
        ),
      ).toBeVisible();

      const bodyAfterSchema = await page.locator('body').innerText();
      expect(bodyAfterSchema).not.toMatch(
        /\b(SyntaxError|ImportParseError|stack trace| at Object\.|\.worker\.ts)\b/i,
      );
      await expectNoRawI18nKeys(page, 'import schema error');
      await shot('import-unsupported-schema-error');
    });
  });

  test('branch: ChatGPT sibling branches split into labelled Conversations', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const forkExport = readFileSync(
      resolve(
        __dirname,
        '../../frontend/src/app/import/fixtures/chatgpt-conversations.json',
      ),
      'utf8',
    );
    // Fixture includes a linear chat + the research fork — keep only the fork
    // conversation for this branch-label assertion.
    const parsed = JSON.parse(forkExport) as { title?: string }[];
    const forkOnly = JSON.stringify(
      parsed.filter((c) => c.title === 'Synthetic research fork'),
    );

    await provisionUnlockedAccount(page);
    await page.getByRole('link', { name: 'Bring existing Conversations' }).click();
    await page.getByRole('button', { name: 'ChatGPT' }).click();
    await page.getByLabel('Choose your export file').setInputFiles({
      name: 'luca-fork.json',
      mimeType: 'application/json',
      buffer: Buffer.from(forkOnly),
    });

    await expect(
      page.getByRole('heading', { name: 'Review before importing' }),
    ).toBeVisible();
    await expect(
      page.getByText('2 Conversations and 4 Messages are ready to review.'),
    ).toBeVisible();
    await expect(page.getByText('Synthetic research fork (1)')).toBeVisible();
    await expect(page.getByText('Synthetic research fork (2)')).toBeVisible();
    await expectNoRawI18nKeys(page, 'chatgpt branch split preview');
  });

  test('branch: imported Conversations surface in Recent without a project drill-down', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const marker = 'LUCA-RECENT-LIST-MARKER-f4a2';

    await provisionUnlockedAccount(page);
    await page.getByRole('link', { name: 'Bring existing Conversations' }).click();
    await page.getByRole('button', { name: 'Claude' }).click();
    await page.getByLabel('Choose your export file').setInputFiles({
      name: 'luca-recent.json',
      mimeType: 'application/json',
      buffer: Buffer.from(
        JSON.stringify([
          {
            uuid: 'luca-recent-conv',
            name: 'Monday client debrief',
            created_at: '2026-01-02T10:00:00Z',
            chat_messages: [
              {
                uuid: 'luca-recent-user',
                sender: 'human',
                text: marker,
                created_at: '2026-01-02T10:00:00Z',
              },
              {
                uuid: 'luca-recent-assistant',
                sender: 'assistant',
                text: 'Debrief summary',
                created_at: '2026-01-02T10:00:01Z',
              },
            ],
          },
        ]),
      ),
    });

    await page.getByRole('button', { name: 'Encrypt and import 1' }).click();
    await expect(page).toHaveURL(/\/c\/[^/]+$/, { timeout: 30_000 });
    await expect(page.getByText(marker)).toBeVisible();

    await page.goto('/');
    await expect(page.getByText('Recent', { exact: true })).toBeVisible();
    await expect(
      page.getByRole('link', { name: 'Monday client debrief' }),
    ).toBeVisible();
    await expectNoRawI18nKeys(page, 'recent list after import');
  });
});
