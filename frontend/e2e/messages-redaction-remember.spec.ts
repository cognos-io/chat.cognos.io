import { expect, test } from '@playwright/test';

import {
  buildConversationFixture,
  buildVaultFixture,
  seedAuthenticatedUnlockState,
} from './fixtures';

const PB = 'http://localhost:8090';

// A value the user manually redacts once is remembered for the conversation and
// auto-redacted in later messages without re-selecting it.
test('a manually redacted value is auto-redacted in later messages', async ({
  page,
}) => {
  const userFixture = buildVaultFixture('user_rem', 'rem@example.com');
  const conversation = buildConversationFixture(userFixture, 'conv_rem', 'Vendors');

  const store: {
    key: { public_key: string; wrapped_secret_key: string } | null;
    entries: Array<{
      token: string;
      data: string;
      key_version: number;
      source_kind: string;
      source_id: string;
    }>;
    sent: string[];
  } = { key: null, entries: [], sent: [] };
  let completeCount = 0;

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
  await page.route(`${PB}/api/v1/conversations/conv_rem/public-key`, (r) =>
    r.fulfill({ json: conversation.conversationPublicKeyRecord }),
  );
  await page.route(`${PB}/api/v1/conversations/conv_rem/secret-key`, (r) =>
    r.fulfill({ json: conversation.conversationSecretKeyRecord }),
  );
  await page.route(
    `${PB}/api/v1/conversations/conv_rem/messages?page=1&page_size=100`,
    (r) =>
      r.fulfill({
        json: { page: 1, perPage: 100, totalItems: 0, totalPages: 1, items: [] },
      }),
  );
  await page.route(`${PB}/api/v1/conversations/conv_rem/redaction-key`, (r) => {
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
  await page.route(`${PB}/api/v1/conversations/conv_rem/redaction-entries`, (r) => {
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
  await page.route(`${PB}/api/v1/conversations/conv_rem/complete`, (r) => {
    const body = r.request().postDataJSON() as {
      messages: Array<{ role: string; content: string }>;
    };
    store.sent.push(body.messages.at(-1)?.content ?? '');
    completeCount += 1;
    const n = completeCount;
    r.fulfill({
      contentType: 'text/event-stream',
      body: [
        `data: ${JSON.stringify({ type: 'delta', delta: `reply ${n}` })}`,
        '',
        `data: ${JSON.stringify({
          type: 'complete',
          response: {
            user_message_id: `mu${n}`,
            assistant_message: {
              id: `ma${n}`,
              parent_message_id: `mu${n}`,
              content: `reply ${n}`,
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

  await page.goto('/c/conv_rem');
  await expect(page.getByRole('heading', { name: 'Vendors' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'EU Model' })).toBeVisible();

  const composer = page.getByLabel(
    'Message Cognos — stored encrypted; sent to your provider to reply',
  );

  // Message 1: manually redact "Acme Corp".
  await composer.fill('Pay Acme Corp now');
  await composer.evaluate((el: HTMLTextAreaElement) => {
    const start = el.value.indexOf('Acme Corp');
    el.setSelectionRange(start, start + 'Acme Corp'.length);
    el.dispatchEvent(
      new MouseEvent('mouseup', { bubbles: true, clientX: 100, clientY: 100 }),
    );
  });
  await page.getByRole('button', { name: 'Redact' }).click();
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('reply 1')).toBeVisible();

  // Message 2: the same value, typed normally — it is remembered, so the
  // composer flags it for redaction without any manual selection.
  await composer.fill('Remind Acme Corp tomorrow');
  await expect(page.getByText('Redacting 1 sensitive value')).toBeVisible();
  await page.getByRole('button', { name: 'Send', exact: true }).click();
  await expect(page.getByText('reply 2')).toBeVisible();

  // Both messages went upstream redacted; neither leaked the company name.
  expect(store.sent).toHaveLength(2);
  for (const content of store.sent) {
    expect(content).not.toContain('Acme Corp');
    expect(content).toContain('[[PII_CUSTOM_');
  }
});
