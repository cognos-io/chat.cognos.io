import { expect, test } from '@playwright/test';

import {
  buildConversationFixture,
  buildMessageRecordFixture,
  buildRedactionFixture,
  buildVaultFixture,
  seedAuthenticatedUnlockState,
} from './fixtures';

const PB = 'http://localhost:8090';

// Clicking a redacted pill opens the shared cog-modal explainer, which must
// show the original value, the placeholder the model saw, and the localised
// "You see" / "The model sees" copy (wired from the app, not the library's
// hardcoded English).
test('redacted pill opens the shared explainer modal with localised copy', async ({
  page,
}) => {
  const userFixture = buildVaultFixture('user_modal', 'modal@example.com');
  const conversation = buildConversationFixture(userFixture, 'conv_modal', 'Invoice');

  const token = '[[PII_IBAN_RABC12]]';
  const original = 'GB82 WEST 1234 5698 7654 32';
  const redaction = buildRedactionFixture(userFixture, [
    {
      token,
      type: 'iban',
      original,
      normalized: 'GB82WEST12345698765432',
      detector: 'iban:v1',
    },
  ]);
  const message = buildMessageRecordFixture(conversation, {
    id: 'msg_modal',
    created: '2026-06-07T00:00:00Z',
    content: `Pay ${token} please`,
    ownerId: userFixture.authState.model.id,
  });

  await seedAuthenticatedUnlockState(page, userFixture);
  await page.route(`${PB}/api/v1/user-key-pair`, (route) =>
    route.fulfill({ json: userFixture.userKeyPairRecord }),
  );
  await page.route(`${PB}/api/v1/vault-session`, (route) =>
    route.fulfill({ json: userFixture.vaultSession }),
  );
  await page.route(`${PB}/api/v1/user-preferences`, (route) =>
    route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }),
  );
  await page.route(`${PB}/api/v1/models`, (route) =>
    route.fulfill({
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
  await page.route(`${PB}/api/v1/conversations`, (route) =>
    route.fulfill({ json: [conversation.conversationRecord] }),
  );
  await page.route(`${PB}/api/v1/conversations/conv_modal/public-key`, (route) =>
    route.fulfill({ json: conversation.conversationPublicKeyRecord }),
  );
  await page.route(`${PB}/api/v1/conversations/conv_modal/secret-key`, (route) =>
    route.fulfill({ json: conversation.conversationSecretKeyRecord }),
  );
  await page.route(
    `${PB}/api/v1/conversations/conv_modal/messages?page=1&page_size=100`,
    (route) =>
      route.fulfill({
        json: { page: 1, perPage: 100, totalItems: 1, totalPages: 1, items: [message] },
      }),
  );
  await page.route(`${PB}/api/v1/conversations/conv_modal/redaction-key`, (route) =>
    route.fulfill({ json: redaction.redactionKeyResponse }),
  );
  await page.route(`${PB}/api/v1/conversations/conv_modal/redaction-entries`, (route) =>
    route.fulfill({ json: redaction.entriesResponse }),
  );

  await page.goto('/c/conv_modal');
  await expect(page.getByRole('heading', { name: 'Invoice' })).toBeVisible();

  // The redacted pill shows the original value inline; click it to open details.
  const pill = page.locator('.cog-redacted-text').first();
  await expect(pill).toContainText(original);
  await pill.click();

  // It is the shared cog-modal, with the app-localised explainer copy.
  const modal = page.locator('.cog-modal');
  await expect(modal).toBeVisible();
  await expect(modal).toContainText('You see');
  await expect(modal).toContainText(original);
  await expect(modal).toContainText('The model sees');
  await expect(modal).toContainText(token);

  // The title must not inherit the prose/markdown h2 underline — the pill (and
  // its modal) lives inside a .cog-prose message body.
  const borderWidth = await page
    .locator('.cog-modal__title')
    .evaluate((el) => getComputedStyle(el).borderBottomWidth);
  expect(borderWidth).toBe('0px');
});
