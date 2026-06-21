import { expect, test } from '@playwright/test';

import {
  buildConversationFixture,
  buildVaultFixture,
  seedAuthenticatedUnlockState,
} from './fixtures';

const PB = 'http://localhost:8090';

// The eye toggle paints the to-be-redacted values directly in the composer.
test('highlight toggle marks redaction targets in the composer', async ({ page }) => {
  const userFixture = buildVaultFixture('user_hl', 'hl@example.com');
  const conversation = buildConversationFixture(userFixture, 'conv_hl', 'Draft');

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
  await page.route(`${PB}/api/v1/conversations/conv_hl/public-key`, (r) =>
    r.fulfill({ json: conversation.conversationPublicKeyRecord }),
  );
  await page.route(`${PB}/api/v1/conversations/conv_hl/secret-key`, (r) =>
    r.fulfill({ json: conversation.conversationSecretKeyRecord }),
  );
  await page.route(
    `${PB}/api/v1/conversations/conv_hl/messages?page=1&page_size=100`,
    (r) =>
      r.fulfill({
        json: { page: 1, perPage: 100, totalItems: 0, totalPages: 1, items: [] },
      }),
  );
  await page.route(`${PB}/api/v1/conversations/conv_hl/redaction-key`, (r) =>
    r.fulfill({ status: 404, contentType: 'application/json', body: '{}' }),
  );
  await page.route(`${PB}/api/v1/conversations/conv_hl/redaction-entries`, (r) =>
    r.fulfill({ json: { items: [] } }),
  );

  await page.goto('/c/conv_hl');
  await expect(page.getByRole('heading', { name: 'Draft' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'EU Model' })).toBeVisible();

  const composer = page.getByLabel(
    'Message Cognos — stored encrypted; sent to your provider to reply',
  );
  await composer.fill(
    'Email jane@example.com and IBAN GB82 WEST 1234 5698 7654 32 today',
  );

  // The redaction summary (and eye toggle) appear once values are detected.
  await expect(page.getByText('Redacting 2 sensitive value(s)')).toBeVisible();

  const highlights = page.locator('.message-form__highlights');
  await expect(highlights).toHaveCount(0); // off by default

  await page.getByRole('button', { name: 'Show what will be redacted' }).click();

  // Both detected values are wrapped in <mark> in the overlay, in place.
  await expect(highlights).toBeVisible();
  await expect(highlights.locator('mark')).toHaveCount(2);
  await expect(highlights.locator('mark').first()).toHaveText('jane@example.com');
  await expect(highlights.locator('mark').last()).toHaveText(
    'GB82 WEST 1234 5698 7654 32',
  );
  // The full draft text is mirrored (not just the marks).
  await expect(highlights).toContainText('Email');
  await expect(highlights).toContainText('today');

  // Toggling off removes the overlay.
  await page.getByRole('button', { name: 'Hide redaction highlight' }).click();
  await expect(highlights).toHaveCount(0);
});
