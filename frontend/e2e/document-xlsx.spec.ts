import { type Page, expect, test } from '@playwright/test';
import { unzipSync } from 'fflate';
import { readFileSync } from 'node:fs';

import {
  ConversationFixture,
  VaultFixture,
  buildConversationFixture,
  buildMessageRecordFixture,
  buildVaultFixture,
  seedAuthenticatedUnlockState,
} from './fixtures';

// Phase 3 (spec docs/specs/document-generation.md §5.3/§5.4/§16): XLSX golden
// bytes (typed cells, a real `<f>` formula, a number format), the formula
// validator's advisory warning path (a reference to a missing sheet, spec
// still downloads with the formula intact), the blocked-function downgrade
// (a network-capable function like WEBSERVICE never reaches the sheet as a
// live formula), and Save-to-library for a docx block (the existing
// attachments pipeline, exercised end to end: real worker, real multipart
// upload, ciphertext-only wire content, no composer chip). Phase 2's
// `<cog-doc>` card/stream/opt-out coverage lives in document-card.spec.ts;
// Phase 1's "Download as…" lives in document-download.spec.ts.

const API = 'http://localhost:8090';

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

// Mirrors seedBaseRoutes/seedConversation in document-card.spec.ts and
// document-download.spec.ts: every route a conversation page needs to reach a
// ready, reload-style history (no live streaming needed for these tests —
// the fixtures below are persisted assistant messages).
const seedConversation = async (
  page: Page,
  conversationId: string,
  title: string,
  assistantContent: string,
): Promise<{ userFixture: VaultFixture; conversationFixture: ConversationFixture }> => {
  const userFixture = buildVaultFixture(
    `user_${conversationId}`,
    `${conversationId}@example.com`,
  );
  const conversationFixture = buildConversationFixture(
    userFixture,
    conversationId,
    title,
  );

  const userMessage = buildMessageRecordFixture(conversationFixture, {
    id: `msg_user_${conversationId}`,
    created: '2026-06-20T09:00:00Z',
    content: 'Give me the file.',
    ownerId: userFixture.authState.model.id,
  });
  const assistantMessage = buildMessageRecordFixture(conversationFixture, {
    id: `msg_assistant_${conversationId}`,
    created: '2026-06-20T09:00:05Z',
    content: assistantContent,
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
    r.fulfill({ json: modelsResponse() }),
  );
  await page.route(`${API}/api/v1/conversations`, (r) =>
    r.fulfill({ json: [conversationFixture.conversationRecord] }),
  );
  await page.route(`${API}/api/v1/conversations/${conversationId}/public-key`, (r) =>
    r.fulfill({ json: conversationFixture.conversationPublicKeyRecord }),
  );
  await page.route(`${API}/api/v1/conversations/${conversationId}/secret-key`, (r) =>
    r.fulfill({ json: conversationFixture.conversationSecretKeyRecord }),
  );
  await page.route(
    `${API}/api/v1/conversations/${conversationId}/messages?page=1&page_size=100`,
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

  return { userFixture, conversationFixture };
};

// --- XLSX fixture (spec §6.3 example, adapted) --------------------------
// Built with JSON.stringify (not hand-typed JSON text) so every variant below
// is guaranteed to be valid JSON with correctly escaped quotes — the blocked-
// function formula in particular embeds a literal `"` that would be easy to
// get wrong by hand.
const XLSX_SPEC_JSON = JSON.stringify({
  v: 1,
  format: 'xlsx',
  title: 'Budget 2026',
  filename: 'budget-2026',
});

const buildSheetBody = (totalFormula: string): string =>
  JSON.stringify({
    sheets: [
      {
        name: 'Budget',
        freezeHeader: true,
        columns: [{ width: 20 }, { width: 14, numFmt: '#,##0.00' }],
        rows: [
          ['Item', 'CHF'],
          ['Hosting', 1200],
          ['Tooling', 800],
          ['Total', { f: totalFormula }],
        ],
      },
    ],
  });

const XLSX_BODY_OK = buildSheetBody('SUM(B2:B3)');
const XLSX_BODY_MISSING_SHEET = buildSheetBody('SUM(Missing!B2:B3)');
const XLSX_BODY_BLOCKED = buildSheetBody('WEBSERVICE("https://evil.example")');

const xlsxContent = (body: string): string =>
  `Here is your budget.\n\n<cog-doc spec='${XLSX_SPEC_JSON}'>\n${body}\n</cog-doc>`;

// --- DOCX fixture for Save-to-library (mirrors document-card.spec.ts's Board
// Brief fixture from spec §6.1's own example) ------------------------------
const DOCX_SPEC_JSON = JSON.stringify({
  v: 1,
  format: 'docx',
  title: 'Board Brief',
  filename: 'board-brief',
});
const DOCX_BODY = [
  '# Board Brief',
  '',
  'Prepared for the quarterly review.',
  '',
  '| Item | Status |',
  '| ---- | ------ |',
  '| Revenue | Up |',
].join('\n');
const DOCX_CONTENT = `Here is your report.\n\n<cog-doc spec='${DOCX_SPEC_JSON}'>\n${DOCX_BODY}\n</cog-doc>\n\nAnything else?`;

// decodeXml is a small helper over fflate's raw Uint8Array archive entries.
const decodeXml = (archive: Record<string, Uint8Array>, path: string): string => {
  const bytes = archive[path];
  expect(bytes, `expected ${path} to exist in the archive`).toBeTruthy();
  return new TextDecoder().decode(bytes);
};

interface MultipartPart {
  name: string;
  filename?: string;
  data: Buffer;
}

// parseMultipart is a minimal, test-only multipart/form-data reader: enough
// to recover named parts (and their raw bytes) from a Playwright-intercepted
// request body without pulling in a dependency. We only need to see which
// fields were sent and whether their bytes look like ciphertext — not a
// general-purpose parser.
const parseMultipart = (buffer: Buffer, contentType: string): MultipartPart[] => {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType);
  const boundary = boundaryMatch?.[1] ?? boundaryMatch?.[2];
  if (!boundary) {
    return [];
  }
  const boundaryBuf = Buffer.from(`--${boundary}`);
  const parts: MultipartPart[] = [];
  let cursor = buffer.indexOf(boundaryBuf);
  if (cursor === -1) {
    return [];
  }
  cursor += boundaryBuf.length;

  for (;;) {
    const nextBoundary = buffer.indexOf(boundaryBuf, cursor);
    if (nextBoundary === -1) {
      break;
    }
    const chunk = buffer.subarray(cursor, nextBoundary);
    const headerEnd = chunk.indexOf('\r\n\r\n');
    if (headerEnd !== -1) {
      const headerText = chunk.subarray(0, headerEnd).toString('utf-8');
      let body = chunk.subarray(headerEnd + 4);
      if (body.subarray(body.length - 2).toString('latin1') === '\r\n') {
        body = body.subarray(0, body.length - 2);
      }
      const nameMatch = /name="([^"]+)"/.exec(headerText);
      const filenameMatch = /filename="([^"]+)"/.exec(headerText);
      if (nameMatch) {
        parts.push({ name: nameMatch[1], filename: filenameMatch?.[1], data: body });
      }
    }
    cursor = nextBoundary + boundaryBuf.length;
    if (buffer.subarray(cursor, cursor + 2).toString('latin1') === '--') {
      break;
    }
  }
  return parts;
};

test.describe('XLSX document card (spec §5.3)', () => {
  test('shows title/tag/Download with no Save-to-library button, and downloads golden xlsx bytes', async ({
    page,
  }) => {
    await seedConversation(
      page,
      'conv_xlsx_ok',
      'Budget xlsx',
      xlsxContent(XLSX_BODY_OK),
    );
    await page.goto('/c/conv_xlsx_ok');

    const assistant = page.locator('.message-list-item__assistant');
    const card = assistant.locator('.document-card');
    await expect(card.getByText('Budget 2026')).toBeVisible();
    await expect(card.getByText('XLSX')).toBeVisible();
    await expect(card.getByRole('button', { name: 'Download' })).toBeVisible();

    // Pinned gating (spec §5.4 "Known gap (xlsx)"): no spreadsheet processor
    // exists in the attachment registry, so the card never offers a save that
    // would guarantee a failure.
    await expect(card.getByRole('button', { name: 'Save to library' })).toHaveCount(0);

    // A spreadsheet card is download-only: sheet-spec JSON is not prose, so
    // unlike docx/pdf there is no expand caret and no inline preview.
    await expect(card.locator('.document-card__caret')).toHaveCount(0);
    await card.locator('.document-card__header').click();
    await expect(card.locator('.document-card__preview')).toHaveCount(0);

    const downloadPromise = page.waitForEvent('download');
    await card.getByRole('button', { name: 'Download' }).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toBe('budget-2026.xlsx');

    const path = await download.path();
    expect(path).not.toBeNull();
    const bytes = readFileSync(path as string);
    expect(bytes.subarray(0, 2).toString('latin1')).toBe('PK');

    const archive = unzipSync(new Uint8Array(bytes));

    const sheetXml = decodeXml(archive, 'xl/worksheets/sheet1.xml');
    expect(sheetXml).toContain('<f>SUM(B2:B3)</f>');

    // 'Hosting' lands in the shared-strings table, not inline in the sheet
    // XML — search every XML part so this doesn't overfit to write-excel-
    // file's current (shared-strings) string encoding choice.
    const allXmlText = Object.entries(archive)
      .filter(([name]) => name.endsWith('.xml'))
      .map(([name]) => decodeXml(archive, name))
      .join('\n');
    expect(allXmlText).toContain('Hosting');

    const stylesXml = decodeXml(archive, 'xl/styles.xml');
    expect(stylesXml).toContain('#,##0.00');

    const workbookXml = decodeXml(archive, 'xl/workbook.xml');
    expect(workbookXml).toContain('name="Budget"');

    // No formula issues in this fixture, so the warning callout never shows.
    await expect(
      card.getByText('Some formulas in this spreadsheet may need checking.'),
    ).toHaveCount(0);
  });

  test('a formula referencing a missing sheet downloads intact but shows the formula warning', async ({
    page,
  }) => {
    await seedConversation(
      page,
      'conv_xlsx_warn',
      'Budget xlsx warning',
      xlsxContent(XLSX_BODY_MISSING_SHEET),
    );
    await page.goto('/c/conv_xlsx_warn');

    const assistant = page.locator('.message-list-item__assistant');
    const card = assistant.locator('.document-card');
    await expect(card.getByText('Budget 2026')).toBeVisible();

    // No warning callout until a download has actually run the validator.
    await expect(
      card.getByText('Some formulas in this spreadsheet may need checking.'),
    ).toHaveCount(0);

    const downloadPromise = page.waitForEvent('download');
    await card.getByRole('button', { name: 'Download' }).click();
    const download = await downloadPromise;

    // Advisory, not blocking (spec §5.3): the reference-topology check flags
    // the missing sheet but the formula is still written verbatim — Excel/
    // LibreOffice show #REF! (or resolve it, if the user later adds the
    // sheet) on open; Cognos never evaluates it.
    await expect(
      card.getByText('Some formulas in this spreadsheet may need checking.'),
    ).toBeVisible();

    const path = await download.path();
    expect(path).not.toBeNull();
    const bytes = readFileSync(path as string);
    const archive = unzipSync(new Uint8Array(bytes));
    const sheetXml = decodeXml(archive, 'xl/worksheets/sheet1.xml');
    expect(sheetXml).toContain('<f>SUM(Missing!B2:B3)</f>');
  });

  test('a network-capable formula (WEBSERVICE) is downgraded to a literal string, never a live formula', async ({
    page,
  }) => {
    await seedConversation(
      page,
      'conv_xlsx_blocked',
      'Budget xlsx blocked',
      xlsxContent(XLSX_BODY_BLOCKED),
    );
    await page.goto('/c/conv_xlsx_blocked');

    const assistant = page.locator('.message-list-item__assistant');
    const card = assistant.locator('.document-card');
    await expect(card.getByText('Budget 2026')).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await card.getByRole('button', { name: 'Download' }).click();
    const download = await downloadPromise;

    await expect(
      card.getByText('Some formulas in this spreadsheet may need checking.'),
    ).toBeVisible();

    const path = await download.path();
    expect(path).not.toBeNull();
    const bytes = readFileSync(path as string);
    const archive = unzipSync(new Uint8Array(bytes));

    // Principle 4 (spec §3): a generated file must never phone home when
    // opened. WEBSERVICE() is blocked-function-downgraded (formula-
    // validator.ts) to a plain-text cell holding the formula source
    // verbatim, prefixed with '=' — the sheet keeps no live `<f>` that could
    // execute it. Search every XML part, not just sheet1.xml, so this holds
    // regardless of which part the library stores the literal string in.
    const allXmlText = Object.entries(archive)
      .filter(([name]) => name.endsWith('.xml'))
      .map(([name]) => decodeXml(archive, name))
      .join('\n');

    // No live <f> formula element anywhere contains the blocked function or
    // the attacker-chosen host.
    const formulaElements = [...allXmlText.matchAll(/<f>([^<]*)<\/f>/g)].map(
      (match) => match[1],
    );
    for (const formula of formulaElements) {
      expect(formula).not.toContain('WEBSERVICE(');
      expect(formula).not.toContain('evil.example');
    }

    // The formula text survives as an inert literal string cell (fail open,
    // not fail silent) — the user can still see what the model tried to do.
    // (Verified against real write-excel-file output: '"' is not XML-entity-
    // escaped inside a shared-string <t> text node, only in attribute values.)
    expect(allXmlText).toContain('WEBSERVICE("https://evil.example")');
  });
});

test.describe('Save to library from a document card (spec §5.4)', () => {
  test('saving a docx block runs the real attachments pipeline with ciphertext-only wire content and no composer chip', async ({
    page,
  }) => {
    await seedConversation(page, 'conv_docx_save', 'Board brief save', DOCX_CONTENT);

    let capturedRequest: { contentType: string; buffer: Buffer } | undefined;
    await page.route(`${API}/api/v1/attachments`, async (route) => {
      if (route.request().method() !== 'POST') {
        return route.continue();
      }
      const buffer = route.request().postDataBuffer();
      capturedRequest = {
        contentType: route.request().headers()['content-type'] ?? '',
        buffer: buffer ?? Buffer.alloc(0),
      };
      return route.fulfill({
        json: {
          id: 'att_board_brief_1',
          size_bytes: buffer?.length ?? 0,
          files: ['art-0.enc'],
          data: 'c2VhbGVkLW1hbmlmZXN0', // opaque placeholder — only the request is under test
          created: '2026-06-20T00:00:00Z',
          updated: '2026-06-20T00:00:00Z',
        },
      });
    });

    await page.goto('/c/conv_docx_save');

    const assistant = page.locator('.message-list-item__assistant');
    const card = assistant.locator('.document-card');
    await expect(card.getByText('Board Brief')).toBeVisible();

    const saveButton = card.getByRole('button', { name: 'Save to library' });
    await expect(saveButton).toBeVisible();
    await saveButton.click();

    // The real worker pipeline (mammoth text extraction, symmetric-key
    // encryption, manifest sealing) runs before the upload fires, so this
    // is slower than a render-only path — generous timeout, not a fixed
    // sleep.
    await expect(card.getByRole('button', { name: 'Saved to library' })).toBeVisible({
      timeout: 15000,
    });
    // Transient — the label reverts to the resting state within a couple of
    // seconds (document-card.component.ts's 2s feedback timer).
    await expect(card.getByRole('button', { name: 'Save to library' })).toBeVisible({
      timeout: 5000,
    });

    expect(capturedRequest).toBeDefined();
    const { contentType, buffer } = capturedRequest!;
    expect(contentType).toContain('multipart/form-data');

    const parts = parseMultipart(buffer, contentType);
    const dataPart = parts.find((part) => part.name === 'data');
    const filePart = parts.find((part) => part.name === 'files');

    // A sealed manifest (base64) was sent...
    expect(dataPart).toBeDefined();
    expect(dataPart!.data.length).toBeGreaterThan(0);
    const manifestText = dataPart!.data.toString('utf-8');
    // ...and it is opaque: ciphertext must never contain the plaintext
    // title or body words (spec §11 "no new plaintext columns").
    expect(manifestText).not.toContain('Board Brief');
    expect(manifestText).not.toContain('Budget');
    expect(manifestText.toLowerCase()).not.toContain('revenue');
    expect(manifestText.toLowerCase()).not.toContain('quarterly review');

    // ...alongside at least one encrypted file artifact.
    expect(filePart).toBeDefined();
    expect(filePart!.filename).toBeTruthy();
    expect(filePart!.data.length).toBeGreaterThan(0);

    // A card save must never surface as a composer attachment chip — it's
    // correlated outside the composer's selection state entirely
    // (AttachmentProcessingService.saveToLibrary, spec §5.4 docstring).
    await expect(page.getByTestId('attachment-chip')).toHaveCount(0);
  });

  test('a failed save shows the transient error and does not crash the card', async ({
    page,
  }) => {
    await seedConversation(
      page,
      'conv_docx_save_fail',
      'Board brief save fail',
      DOCX_CONTENT,
    );

    await page.route(`${API}/api/v1/attachments`, async (route) => {
      if (route.request().method() !== 'POST') {
        return route.continue();
      }
      return route.fulfill({
        status: 500,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Internal error' }),
      });
    });

    await page.goto('/c/conv_docx_save_fail');

    const assistant = page.locator('.message-list-item__assistant');
    const card = assistant.locator('.document-card');
    await expect(card.getByText('Board Brief')).toBeVisible();

    const saveButton = card.getByRole('button', { name: 'Save to library' });
    await saveButton.click();

    await expect(
      card.getByRole('button', { name: "Couldn't save the file. Please try again." }),
    ).toBeVisible();

    // Transient, and the card recovers to its normal resting state — no
    // crash, no stuck error state.
    await expect(saveButton).toBeVisible({ timeout: 5000 });
    await expect(card.getByText('Board Brief')).toBeVisible();
    await expect(page.getByTestId('attachment-chip')).toHaveCount(0);
  });
});
