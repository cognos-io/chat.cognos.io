import { expect, test } from '@playwright/test';

import {
  buildConversationFixture,
  buildVaultFixture,
  seedAuthenticatedUnlockState,
} from './fixtures';

const PB = 'http://localhost:8090';

// A user can select arbitrary text in the composer and redact it manually; the
// completion request must then carry a placeholder, never the selected value.
test('manual selection redaction replaces the chosen text before send', async ({
  page,
}) => {
  const userFixture = buildVaultFixture('user_manual', 'manual@example.com');
  const conversation = buildConversationFixture(userFixture, 'conv_manual', 'Notes');

  let sentContent = '';

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
  await page.route(`${PB}/api/v1/conversations/conv_manual/public-key`, (r) =>
    r.fulfill({ json: conversation.conversationPublicKeyRecord }),
  );
  await page.route(`${PB}/api/v1/conversations/conv_manual/secret-key`, (r) =>
    r.fulfill({ json: conversation.conversationSecretKeyRecord }),
  );
  await page.route(
    `${PB}/api/v1/conversations/conv_manual/messages?page=1&page_size=100`,
    (r) =>
      r.fulfill({
        json: { page: 1, perPage: 100, totalItems: 0, totalPages: 1, items: [] },
      }),
  );
  await page.route(`${PB}/api/v1/conversations/conv_manual/redaction-key`, (r) => {
    if (r.request().method() === 'POST') return r.fulfill({ json: { key_version: 1 } });
    return r.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });
  await page.route(`${PB}/api/v1/conversations/conv_manual/redaction-entries`, (r) =>
    r.fulfill({
      json: r.request().method() === 'POST' ? { created: [] } : { items: [] },
    }),
  );
  await page.route(`${PB}/api/v1/conversations/conv_manual/complete`, (r) => {
    const body = r.request().postDataJSON() as {
      messages: Array<{ role: string; content: string }>;
    };
    sentContent = body.messages.at(-1)?.content ?? '';
    r.fulfill({
      contentType: 'text/event-stream',
      body: [
        `data: ${JSON.stringify({ type: 'delta', delta: 'ok' })}`,
        '',
        `data: ${JSON.stringify({
          type: 'complete',
          response: {
            user_message_id: 'mu',
            assistant_message: {
              id: 'ma',
              parent_message_id: 'mu',
              content: 'ok',
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

  await page.goto('/c/conv_manual');
  await expect(page.getByRole('heading', { name: 'Notes' })).toBeVisible();

  const composer = page.getByLabel(
    'Message Cognos — stored encrypted; sent to your provider to reply',
  );
  await composer.fill('Please email Acme Corp about the order');

  // Select "Acme Corp" in the textarea and raise the inline redact action.
  await composer.evaluate((el: HTMLTextAreaElement) => {
    const start = el.value.indexOf('Acme Corp');
    el.setSelectionRange(start, start + 'Acme Corp'.length);
    el.dispatchEvent(
      new MouseEvent('mouseup', { bubbles: true, clientX: 120, clientY: 120 }),
    );
  });

  await page.getByRole('button', { name: 'Redact' }).click();
  // The manual redaction now shows in the preview.
  await expect(page.getByText('Redacting 1 sensitive value')).toBeVisible();

  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('ok')).toBeVisible();

  // The provider received a placeholder, not the selected company name.
  expect(sentContent).not.toContain('Acme Corp');
  expect(sentContent).toContain('[[PII_CUSTOM_');
});
