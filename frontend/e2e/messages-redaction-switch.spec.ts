import { expect, test } from '@playwright/test';

import {
  buildConversationFixture,
  buildMessageRecordFixture,
  buildRedactionFixture,
  buildVaultFixture,
  seedAuthenticatedUnlockState,
} from './fixtures';

const MODELS_RESPONSE = {
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
      pricing: { input_usd_per_million_tokens: 1, output_usd_per_million_tokens: 2 },
      is_eligible: true,
    },
  ],
};

// Regression: redacted values must keep rendering as pills after switching
// conversations in-app and back. The redaction mappings are loaded per
// conversation; navigating away and back must re-show the originals, not leave
// raw placeholders (or nothing).
test('redacted values stay visible after switching conversations and back', async ({
  page,
}) => {
  const userFixture = buildVaultFixture('user_e2e', 'e2e@example.com');

  const redactedConversation = buildConversationFixture(
    userFixture,
    'conv_red_a',
    'Redacted chat',
  );
  const otherConversation = buildConversationFixture(
    userFixture,
    'conv_red_b',
    'Other chat',
  );

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

  const createdAt = '2026-06-07T00:00:00Z';
  const redactedMessage = buildMessageRecordFixture(redactedConversation, {
    id: 'msg_red_a',
    created: createdAt,
    content: `Please transfer to ${token} today`,
    ownerId: userFixture.authState.model.id,
  });
  const otherMessage = buildMessageRecordFixture(otherConversation, {
    id: 'msg_red_b',
    created: createdAt,
    content: 'Just a normal note with nothing sensitive',
    ownerId: userFixture.authState.model.id,
  });

  await seedAuthenticatedUnlockState(page, userFixture);

  await page.route('http://localhost:8090/api/v1/user-key-pair', async (route) => {
    await route.fulfill({ json: userFixture.userKeyPairRecord });
  });
  await page.route('http://localhost:8090/api/v1/vault-session', async (route) => {
    await route.fulfill({ json: userFixture.vaultSession });
  });
  await page.route('http://localhost:8090/api/v1/user-preferences', async (route) => {
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Not found' }),
    });
  });
  await page.route('http://localhost:8090/api/v1/models', async (route) => {
    await route.fulfill({
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
      },
    });
  });

  await page.route('http://localhost:8090/api/v1/conversations', async (route) => {
    await route.fulfill({
      json: [
        redactedConversation.conversationRecord,
        otherConversation.conversationRecord,
      ],
    });
  });

  // --- Redacted conversation (conv_red_a) ---
  await page.route(
    'http://localhost:8090/api/v1/conversations/conv_red_a/public-key',
    async (route) => {
      await route.fulfill({ json: redactedConversation.conversationPublicKeyRecord });
    },
  );
  await page.route(
    'http://localhost:8090/api/v1/conversations/conv_red_a/secret-key',
    async (route) => {
      await route.fulfill({ json: redactedConversation.conversationSecretKeyRecord });
    },
  );
  await page.route(
    'http://localhost:8090/api/v1/conversations/conv_red_a/messages?page=1&page_size=100',
    async (route) => {
      await route.fulfill({
        json: {
          page: 1,
          perPage: 100,
          totalItems: 1,
          totalPages: 1,
          items: [redactedMessage],
        },
      });
    },
  );
  await page.route(
    'http://localhost:8090/api/v1/conversations/conv_red_a/redaction-key',
    async (route) => {
      await route.fulfill({ json: redaction.redactionKeyResponse });
    },
  );
  await page.route(
    'http://localhost:8090/api/v1/conversations/conv_red_a/redaction-entries',
    async (route) => {
      await route.fulfill({ json: redaction.entriesResponse });
    },
  );

  // --- Plain conversation (conv_red_b) ---
  await page.route(
    'http://localhost:8090/api/v1/conversations/conv_red_b/public-key',
    async (route) => {
      await route.fulfill({ json: otherConversation.conversationPublicKeyRecord });
    },
  );
  await page.route(
    'http://localhost:8090/api/v1/conversations/conv_red_b/secret-key',
    async (route) => {
      await route.fulfill({ json: otherConversation.conversationSecretKeyRecord });
    },
  );
  await page.route(
    'http://localhost:8090/api/v1/conversations/conv_red_b/messages?page=1&page_size=100',
    async (route) => {
      await route.fulfill({
        json: {
          page: 1,
          perPage: 100,
          totalItems: 1,
          totalPages: 1,
          items: [otherMessage],
        },
      });
    },
  );
  // No redaction key for the plain conversation.
  await page.route(
    'http://localhost:8090/api/v1/conversations/conv_red_b/redaction-key',
    async (route) => {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Not found' }),
      });
    },
  );
  await page.route(
    'http://localhost:8090/api/v1/conversations/conv_red_b/redaction-entries',
    async (route) => {
      await route.fulfill({ json: { items: [] } });
    },
  );

  // Open the redacted conversation: the original value renders (as a pill), and
  // the raw placeholder token is not shown.
  await page.goto('/c/conv_red_a');
  await expect(page.getByRole('heading', { name: 'Redacted chat' })).toBeVisible();
  await expect(page.getByText(original)).toBeVisible();
  await expect(page.getByText(token)).toHaveCount(0);

  // Switch to the other conversation in-app (no reload).
  await page
    .locator('.conversation-list-item__link', { hasText: 'Other chat' })
    .click();
  await expect(
    page.getByText('Just a normal note with nothing sensitive'),
  ).toBeVisible();
  await expect(page.getByText(original)).toHaveCount(0);

  // Switch back to the redacted conversation in-app — the original value must
  // render again (this is the regression).
  await page
    .locator('.conversation-list-item__link', { hasText: 'Redacted chat' })
    .click();
  await expect(page.getByRole('heading', { name: 'Redacted chat' })).toBeVisible();
  await expect(page.getByText(original)).toBeVisible();
  await expect(page.getByText(token)).toHaveCount(0);
});

// Closer to the real flow: the user TYPES a value, sends it (which mints the
// redaction key + mapping in-session), sees the pill, then switches away and
// back. The mapping must reload from the backend, not vanish.
test('redacted values persist across a switch after sending in-session', async ({
  page,
}) => {
  const userFixture = buildVaultFixture('user_e2e', 'e2e@example.com');
  const conversationA = buildConversationFixture(
    userFixture,
    'conv_send_a',
    'Money chat',
  );
  const conversationB = buildConversationFixture(
    userFixture,
    'conv_send_b',
    'Small talk',
  );

  const iban = 'GB82 WEST 1234 5698 7654 32';

  // Stateful server mirror: what the client POSTs is what later GETs return.
  const store: {
    redactionKey: { public_key: string; wrapped_secret_key: string } | null;
    entries: Array<{
      token: string;
      data: string;
      key_version: number;
      source_kind: string;
      source_id: string;
    }>;
    redactedUserContent: string | null;
  } = { redactionKey: null, entries: [], redactedUserContent: null };

  await seedAuthenticatedUnlockState(page, userFixture);

  await page.route('http://localhost:8090/api/v1/user-key-pair', (route) =>
    route.fulfill({ json: userFixture.userKeyPairRecord }),
  );
  await page.route('http://localhost:8090/api/v1/vault-session', (route) =>
    route.fulfill({ json: userFixture.vaultSession }),
  );
  await page.route('http://localhost:8090/api/v1/user-preferences', (route) =>
    route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }),
  );
  await page.route('http://localhost:8090/api/v1/models', (route) =>
    route.fulfill({ json: MODELS_RESPONSE }),
  );
  await page.route('http://localhost:8090/api/v1/conversations', (route) =>
    route.fulfill({
      json: [conversationA.conversationRecord, conversationB.conversationRecord],
    }),
  );

  await page.route(
    'http://localhost:8090/api/v1/conversations/conv_send_a/public-key',
    (route) => route.fulfill({ json: conversationA.conversationPublicKeyRecord }),
  );
  await page.route(
    'http://localhost:8090/api/v1/conversations/conv_send_a/secret-key',
    (route) => route.fulfill({ json: conversationA.conversationSecretKeyRecord }),
  );
  await page.route(
    'http://localhost:8090/api/v1/conversations/conv_send_a/messages?page=1&page_size=100',
    (route) => {
      const items = store.redactedUserContent
        ? [
            buildMessageRecordFixture(conversationA, {
              id: 'msg_sent_user',
              created: '2026-06-07T00:00:00Z',
              content: store.redactedUserContent,
              ownerId: userFixture.authState.model.id,
            }),
            buildMessageRecordFixture(conversationA, {
              id: 'msg_sent_assistant',
              created: '2026-06-07T00:00:05Z',
              content: 'Understood.',
              personaId: 'cognos:simple-assistant',
              modelId: 'eu-model',
              parentMessageId: 'msg_sent_user',
            }),
          ]
        : [];
      route.fulfill({
        json: { page: 1, perPage: 100, totalItems: items.length, totalPages: 1, items },
      });
    },
  );

  // Redaction key: 404 until the client creates it, then echo it back.
  await page.route(
    'http://localhost:8090/api/v1/conversations/conv_send_a/redaction-key',
    (route) => {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON() as {
          public_key: string;
          keys: { user_id: string; wrapped_secret_key: string }[];
        };
        store.redactionKey = {
          public_key: body.public_key,
          wrapped_secret_key: body.keys[0].wrapped_secret_key,
        };
        return route.fulfill({ json: { key_version: 1 } });
      }
      if (!store.redactionKey) {
        return route.fulfill({
          status: 404,
          contentType: 'application/json',
          body: '{}',
        });
      }
      return route.fulfill({ json: { ...store.redactionKey, key_version: 1 } });
    },
  );

  await page.route(
    'http://localhost:8090/api/v1/conversations/conv_send_a/redaction-entries',
    (route) => {
      if (route.request().method() === 'POST') {
        const body = route.request().postDataJSON() as {
          entries: {
            token: string;
            data: string;
            source_kind: string;
            source_id?: string;
          }[];
        };
        for (const e of body.entries) {
          store.entries.push({
            token: e.token,
            data: e.data,
            key_version: 1,
            source_kind: e.source_kind,
            source_id: e.source_id ?? '',
          });
        }
        return route.fulfill({ json: { created: body.entries.map((e) => e.token) } });
      }
      return route.fulfill({ json: { items: store.entries } });
    },
  );

  await page.route(
    'http://localhost:8090/api/v1/conversations/conv_send_a/complete',
    (route) => {
      const body = route.request().postDataJSON() as {
        messages: Array<{ role: string; content: string }>;
      };
      // The last user message is the REDACTED text the client sent upstream.
      store.redactedUserContent = body.messages.at(-1)?.content ?? '';
      route.fulfill({
        contentType: 'text/event-stream',
        body: [
          `data: ${JSON.stringify({ type: 'delta', delta: 'Understood.' })}`,
          '',
          `data: ${JSON.stringify({
            type: 'complete',
            response: {
              user_message_id: 'msg_sent_user',
              assistant_message: {
                id: 'msg_sent_assistant',
                parent_message_id: 'msg_sent_user',
                content: 'Understood.',
                persona_id: 'cognos:simple-assistant',
                model_id: 'eu-model',
                created_at: '2026-06-07T00:00:05Z',
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
    },
  );

  // Plain conversation B.
  await page.route(
    'http://localhost:8090/api/v1/conversations/conv_send_b/public-key',
    (route) => route.fulfill({ json: conversationB.conversationPublicKeyRecord }),
  );
  await page.route(
    'http://localhost:8090/api/v1/conversations/conv_send_b/secret-key',
    (route) => route.fulfill({ json: conversationB.conversationSecretKeyRecord }),
  );
  await page.route(
    'http://localhost:8090/api/v1/conversations/conv_send_b/messages?page=1&page_size=100',
    (route) =>
      route.fulfill({
        json: { page: 1, perPage: 100, totalItems: 0, totalPages: 1, items: [] },
      }),
  );
  await page.route(
    'http://localhost:8090/api/v1/conversations/conv_send_b/redaction-key',
    (route) =>
      route.fulfill({ status: 404, contentType: 'application/json', body: '{}' }),
  );
  await page.route(
    'http://localhost:8090/api/v1/conversations/conv_send_b/redaction-entries',
    (route) => route.fulfill({ json: { items: [] } }),
  );

  await page.goto('/c/conv_send_a');
  await expect(page.getByRole('heading', { name: 'Money chat' })).toBeVisible();

  const composer = page.getByLabel(
    'Message Cognos — stored encrypted; sent to your provider to reply',
  );
  await composer.fill(`Please transfer to ${iban}`);
  await page.getByRole('button', { name: 'Send' }).click();

  // The sent message shows the original value (as a pill); the IBAN never went
  // upstream raw.
  await expect(page.getByText(iban)).toBeVisible();
  expect(store.redactedUserContent).not.toContain('GB82');
  expect(store.redactedUserContent).toContain('[[PII_IBAN_');

  // Switch away and back in-app.
  await page
    .locator('.conversation-list-item__link', { hasText: 'Small talk' })
    .click();
  await expect(page.getByText(iban)).toHaveCount(0);

  await page
    .locator('.conversation-list-item__link', { hasText: 'Money chat' })
    .click();
  await expect(page.getByRole('heading', { name: 'Money chat' })).toBeVisible();
  // Regression: the original must render again after returning.
  await expect(page.getByText(iban)).toBeVisible();
});
