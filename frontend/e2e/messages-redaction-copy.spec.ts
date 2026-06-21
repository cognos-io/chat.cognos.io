import { expect, test } from '@playwright/test';

import {
  buildConversationFixture,
  buildMessageRecordFixture,
  buildRedactionFixture,
  buildVaultFixture,
  seedAuthenticatedUnlockState,
} from './fixtures';

const PB = 'http://localhost:8090';
const IBAN = 'GB82 WEST 1234 5698 7654 32';
const TOKEN = '[[PII_IBAN_RCOPY1]]';

// Copying a message with redacted content offers a choice: the real values or
// the placeholder ("[redacted]") version.
test('copy menu offers sensitive vs redacted variants', async ({ page }) => {
  const userFixture = buildVaultFixture('user_copy', 'copy@example.com');
  const conversation = buildConversationFixture(userFixture, 'conv_copy', 'Invoice');
  const redaction = buildRedactionFixture(userFixture, [
    {
      token: TOKEN,
      type: 'iban',
      original: IBAN,
      normalized: 'GB82WEST12345698765432',
      detector: 'iban:v1',
    },
  ]);
  const message = buildMessageRecordFixture(conversation, {
    id: 'm_copy',
    created: '2026-06-07T00:00:00Z',
    content: `Pay ${TOKEN} now`,
    ownerId: userFixture.authState.model.id,
  });

  // Capture clipboard writes (headless chromium has no real clipboard).
  await page.addInitScript(() => {
    (window as unknown as { __copied: string[] }).__copied = [];
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (text: string) => {
          (window as unknown as { __copied: string[] }).__copied.push(text);
          return Promise.resolve();
        },
      },
    });
  });

  await seedAuthenticatedUnlockState(page, userFixture);
  await page.route(`${PB}/api/v1/user-key-pair`, (r) =>
    r.fulfill({ json: userFixture.userKeyPairRecord }),
  );
  await page.route(`${PB}/api/v1/vault-session`, (r) =>
    r.fulfill({ json: userFixture.vaultSession }),
  );
  await page.route(`${PB}/api/v1/user-preferences`, (r) =>
    r.fulfill({ status: 404, contentType: 'application/json', body: '{}' }),
  );
  await page.route(`${PB}/api/v1/models`, (r) =>
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
            description: 'Eligible model',
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
  await page.route(`${PB}/api/v1/conversations`, (r) =>
    r.fulfill({ json: [conversation.conversationRecord] }),
  );
  await page.route(`${PB}/api/v1/conversations/conv_copy/public-key`, (r) =>
    r.fulfill({ json: conversation.conversationPublicKeyRecord }),
  );
  await page.route(`${PB}/api/v1/conversations/conv_copy/secret-key`, (r) =>
    r.fulfill({ json: conversation.conversationSecretKeyRecord }),
  );
  await page.route(
    `${PB}/api/v1/conversations/conv_copy/messages?page=1&page_size=100`,
    (r) =>
      r.fulfill({
        json: { page: 1, perPage: 100, totalItems: 1, totalPages: 1, items: [message] },
      }),
  );
  await page.route(`${PB}/api/v1/conversations/conv_copy/redaction-key`, (r) =>
    r.fulfill({ json: redaction.redactionKeyResponse }),
  );
  await page.route(`${PB}/api/v1/conversations/conv_copy/redaction-entries`, (r) =>
    r.fulfill({ json: redaction.entriesResponse }),
  );

  await page.goto('/c/conv_copy');
  const userMessage = page.locator('.message-list-item__user');
  // The pill hydrates the original once mappings load.
  await expect(userMessage).toContainText(IBAN);

  const copied = () =>
    page.evaluate(() => (window as unknown as { __copied: string[] }).__copied);

  // Copy the redacted version.
  await userMessage.hover();
  await userMessage.getByRole('button', { name: 'Copy to clipboard' }).click();
  await page.getByRole('menuitem', { name: 'Copy redacted' }).click();
  await expect.poll(copied).toContain('Pay [redacted] now');

  // Copy with sensitive values.
  await userMessage.hover();
  await userMessage.getByRole('button', { name: 'Copy to clipboard' }).click();
  await page.getByRole('menuitem', { name: 'Copy with sensitive values' }).click();
  await expect.poll(copied).toContain(`Pay ${IBAN} now`);
});
