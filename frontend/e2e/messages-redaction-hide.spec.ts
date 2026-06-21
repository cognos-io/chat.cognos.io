import { expect, test } from '@playwright/test';

import {
  buildConversationFixture,
  buildVaultFixture,
  seedAuthenticatedUnlockState,
} from './fixtures';

const PB = 'http://localhost:8090';

// The conversation menu can mask redacted values in the rendered chat (for
// screen sharing) without un-redacting the stored message or leaking the value.
test('the conversation menu hides and re-shows redacted values', async ({ page }) => {
  const userFixture = buildVaultFixture('user_hide', 'hide@example.com');
  const conversation = buildConversationFixture(userFixture, 'conv_hide', 'Letter');

  const store: {
    key: { public_key: string; wrapped_secret_key: string } | null;
    entries: Array<{
      token: string;
      data: string;
      key_version: number;
      source_kind: string;
      source_id: string;
    }>;
  } = { key: null, entries: [] };

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
  await page.route(`${PB}/api/v1/conversations/conv_hide/public-key`, (r) =>
    r.fulfill({ json: conversation.conversationPublicKeyRecord }),
  );
  await page.route(`${PB}/api/v1/conversations/conv_hide/secret-key`, (r) =>
    r.fulfill({ json: conversation.conversationSecretKeyRecord }),
  );
  await page.route(
    `${PB}/api/v1/conversations/conv_hide/messages?page=1&page_size=100`,
    (r) =>
      r.fulfill({
        json: { page: 1, perPage: 100, totalItems: 0, totalPages: 1, items: [] },
      }),
  );
  await page.route(`${PB}/api/v1/conversations/conv_hide/redaction-key`, (r) => {
    if (r.request().method() === 'POST') {
      const b = r.request().postDataJSON() as {
        public_key: string;
        keys: { wrapped_secret_key: string }[];
      };
      store.key = {
        public_key: b.public_key,
        wrapped_secret_key: b.keys[0].wrapped_secret_key,
      };
      return r.fulfill({ json: { key_version: 1 } });
    }
    return store.key
      ? r.fulfill({ json: { ...store.key, key_version: 1 } })
      : r.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });
  await page.route(`${PB}/api/v1/conversations/conv_hide/redaction-entries`, (r) => {
    if (r.request().method() === 'POST') {
      const b = r.request().postDataJSON() as {
        entries: {
          token: string;
          data: string;
          source_kind: string;
          source_id?: string;
        }[];
      };
      for (const e of b.entries) {
        store.entries.push({
          token: e.token,
          data: e.data,
          key_version: 1,
          source_kind: e.source_kind,
          source_id: e.source_id ?? '',
        });
      }
      return r.fulfill({ json: { created: b.entries.map((e) => e.token) } });
    }
    return r.fulfill({ json: { items: store.entries } });
  });
  await page.route(`${PB}/api/v1/conversations/conv_hide/complete`, (r) => {
    r.fulfill({
      contentType: 'text/event-stream',
      body: [
        `data: ${JSON.stringify({ type: 'delta', delta: 'reply' })}`,
        '',
        `data: ${JSON.stringify({
          type: 'complete',
          response: {
            user_message_id: 'mu1',
            assistant_message: {
              id: 'ma1',
              parent_message_id: 'mu1',
              content: 'reply',
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

  await page.goto('/c/conv_hide');
  await expect(page.getByRole('heading', { name: 'Letter' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'EU Model' })).toBeVisible();

  const composer = page.getByLabel(
    'Message Cognos — stored encrypted; sent to your provider to reply',
  );
  await composer.fill('Email jane@example.com please');
  await page.getByRole('button', { name: 'Send', exact: true }).click();

  // The sent bubble reveals the original value to the owner via the pill (its
  // presence also confirms the message sent and the mapping hydrated).
  const message = page.locator('app-message-list-item').first();
  await expect(message.getByText('jane@example.com')).toBeVisible();

  // Hide values from the conversation menu.
  await page.getByRole('button', { name: 'Conversation menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Hide sensitive values' }).click();

  await expect(message.getByText('jane@example.com')).toHaveCount(0);
  await expect(message.getByText('••••••')).toBeVisible();

  // Re-showing brings the value back.
  await page.getByRole('button', { name: 'Conversation menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Show sensitive values' }).click();
  await expect(message.getByText('jane@example.com')).toBeVisible();
});
