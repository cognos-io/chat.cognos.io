import { expect, test } from '@playwright/test';
import { unzipSync } from 'fflate';
import { readFileSync } from 'node:fs';

import {
  buildConversationFixture,
  buildImageAttachmentFixture,
  buildMessageRecordFixture,
  buildVaultFixture,
  seedAuthenticatedUnlockState,
} from './fixtures';

const API = 'http://localhost:8090';
const CONVERSATION_ID = 'convimgexp00001';
const MESSAGE_ID = 'msgimgexp000001';

// The decrypted image bytes the export must reconstruct into the archive.
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

test('exports a conversation with a generated image as a zip', async ({ page }) => {
  const userFixture = buildVaultFixture('user_e2e_imgexp', 'imgexp@example.com');
  const conversationFixture = buildConversationFixture(
    userFixture,
    CONVERSATION_ID,
    'Image export chat',
  );
  const attachment = buildImageAttachmentFixture(conversationFixture, PNG_BYTES);

  // An assistant message whose decrypted payload references one encrypted image.
  const messageFixture = buildMessageRecordFixture(conversationFixture, {
    id: MESSAGE_ID,
    created: '2026-06-01T10:00:00Z',
    content: '',
    modelId: 'gemini-2-5-flash-image',
    attachments: [
      {
        kind: 'generated_image',
        mime_type: 'image/png',
        sealed_key: attachment.sealedKeyBase64,
      },
    ],
  });

  await seedAuthenticatedUnlockState(page, userFixture);
  await page.route(`${API}/api/v1/user-key-pair`, (r) =>
    r.fulfill({ json: userFixture.userKeyPairRecord }),
  );
  await page.route(`${API}/api/v1/vault-session`, (r) =>
    r.fulfill({ json: userFixture.vaultSession }),
  );
  await page.route(`${API}/api/v1/user-preferences`, (r) =>
    r.fulfill({ status: 404, json: { message: 'Not found' } }),
  );
  await page.route(`${API}/api/v1/models`, (r) =>
    r.fulfill({ json: { privacy_tier: 'eu', preferred_model_id: 'm', models: [] } }),
  );
  await page.route(`${API}/api/v1/billing`, (r) =>
    r.fulfill({
      json: { plan_type: 'trial', status: 'trial', balance_chf: 2, trial_seed_chf: 2 },
    }),
  );
  await page.route(`${API}/api/v1/billing/usage`, (r) =>
    r.fulfill({
      json: { period_start: '2026-06-01T00:00:00Z', message_count: 0, by_model: [] },
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
          totalItems: 1,
          totalPages: 1,
          items: [messageFixture],
        },
      }),
  );
  // The encrypted attachment bytes the export fetches and decrypts.
  await page.route(
    `${API}/api/v1/conversations/${CONVERSATION_ID}/messages/*/attachment`,
    (r) =>
      r.fulfill({
        contentType: 'application/octet-stream',
        body: Buffer.from(attachment.ciphertext),
      }),
  );

  await page.setViewportSize({ width: 1280, height: 800 });

  const conversationsLoaded = page.waitForResponse((r) =>
    /\/api\/v1\/conversations(\?.*)?$/.test(r.url()),
  );
  await page.goto('/account');
  await conversationsLoaded;

  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download my data' }).click();
  const download = await downloadPromise;

  // With an image present, the export is a zip.
  expect(download.suggestedFilename()).toMatch(/\.zip$/);

  const path = await download.path();
  const archive = unzipSync(new Uint8Array(readFileSync(path)));

  // The JSON references the image by its archive path.
  const manifest = JSON.parse(new TextDecoder().decode(archive['conversation.json']));
  const message = manifest.conversations[0].messages[0];
  const expectedPath = `images/${MESSAGE_ID}-0.png`;
  expect(message.attachments).toEqual([
    { kind: 'generated_image', mime_type: 'image/png', file: expectedPath },
  ]);

  // The archived image is the correctly-decrypted plaintext PNG.
  expect(archive[expectedPath]).toBeTruthy();
  expect(Buffer.from(archive[expectedPath]).equals(PNG_BYTES)).toBe(true);
});
