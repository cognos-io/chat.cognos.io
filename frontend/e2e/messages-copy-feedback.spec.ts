import { expect, test } from '@playwright/test';

import {
  buildConversationFixture,
  buildVaultFixture,
  seedAuthenticatedUnlockState,
} from './fixtures';

const PB = 'http://localhost:8090';

// Copying a message gives visual feedback: the copy icon flips to a tick and
// its label changes to "Copied" for a moment, then reverts.
test('copying a message shows a transient copied confirmation', async ({ page }) => {
  const userFixture = buildVaultFixture('user_copy', 'copy@example.com');
  const conversation = buildConversationFixture(userFixture, 'conv_copy', 'Notes');

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
        json: { page: 1, perPage: 100, totalItems: 0, totalPages: 1, items: [] },
      }),
  );
  await page.route(`${PB}/api/v1/conversations/conv_copy/redaction-key`, (r) =>
    r.fulfill({ status: 404, contentType: 'application/json', body: '{}' }),
  );
  await page.route(`${PB}/api/v1/conversations/conv_copy/redaction-entries`, (r) =>
    r.fulfill({ json: { items: [] } }),
  );
  await page.route(`${PB}/api/v1/conversations/conv_copy/complete`, (r) => {
    r.fulfill({
      contentType: 'text/event-stream',
      body: [
        `data: ${JSON.stringify({ type: 'delta', delta: 'sure thing' })}`,
        '',
        `data: ${JSON.stringify({
          type: 'complete',
          response: {
            user_message_id: 'mu1',
            assistant_message: {
              id: 'ma1',
              parent_message_id: 'mu1',
              content: 'sure thing',
              persona_id: 'cognos:simple-assistant',
              model_id: 'eu-model',
              created_at: '2026-06-07T00:00:00Z',
            },
            usage: {
              input_tokens: 1,
              output_tokens: 1,
              total_tokens: 2,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
              cost_usd: 0,
              cost_chf: 0,
              cost_rappen: 0,
              used_provider_cost: true,
            },
          },
        })}`,
        '',
      ].join('\n'),
    });
  });

  await page.goto('/c/conv_copy');
  await expect(page.getByRole('heading', { name: 'Notes' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'EU Model' })).toBeVisible();

  const composer = page.getByLabel(
    'Message Cognos — stored encrypted; sent to your provider to reply',
  );
  await composer.fill('Remember the milk');
  await page.getByRole('button', { name: 'Send', exact: true }).click();

  const message = page.locator('app-message-list-item').first();
  await expect(message.getByText('Remember the milk')).toBeVisible();

  // Copy the message; the control confirms with a "Copied" state, then reverts.
  await message.getByRole('button', { name: 'Copy to clipboard' }).click();
  await expect(message.getByRole('button', { name: 'Copied' })).toBeVisible();
  await expect(message.getByRole('button', { name: 'Copy to clipboard' })).toBeVisible({
    timeout: 4000,
  });
});
