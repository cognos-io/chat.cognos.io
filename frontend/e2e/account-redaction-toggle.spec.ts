import { expect, test } from '@playwright/test';

import {
  buildConversationFixture,
  buildVaultFixture,
  seedAuthenticatedUnlockState,
} from './fixtures';

const PB = 'http://localhost:8090';

// Redaction is on by default (secure by default); the user can turn it off in
// settings and future messages then go out un-redacted.
test('disabling redaction in settings turns it off for future messages', async ({
  page,
}) => {
  const userFixture = buildVaultFixture('user_set', 'set@example.com');
  const conversation = buildConversationFixture(userFixture, 'conv_set', 'Tickets');

  // Stateful preferences: the client encrypts its own payload, so we capture
  // the POSTed `data` and echo it back on later GETs (survives reloads).
  let prefsData: string | null = null;
  const prefsRecord = () => ({
    id: 'up_e2e',
    collectionId: 'user_preferences',
    collectionName: 'user_preferences',
    created: '2026-06-01T00:00:00Z',
    updated: '2026-06-01T00:00:00Z',
    user: userFixture.authState.model.id,
    data: prefsData,
  });

  await seedAuthenticatedUnlockState(page, userFixture);
  await page.route(`${PB}/api/v1/user-key-pair`, (r) =>
    r.fulfill({ json: userFixture.userKeyPairRecord }),
  );
  await page.route(`${PB}/api/v1/vault-session`, (r) =>
    r.fulfill({ json: userFixture.vaultSession }),
  );
  await page.route(`${PB}/api/v1/user-preferences`, (r) => {
    if (r.request().method() === 'POST') {
      prefsData = (r.request().postDataJSON() as { data: string }).data;
      return r.fulfill({ json: prefsRecord() });
    }
    return prefsData
      ? r.fulfill({ json: prefsRecord() })
      : r.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });
  await page.route(`${PB}/api/v1/user-preferences/up_e2e`, (r) => {
    prefsData = (r.request().postDataJSON() as { data: string }).data;
    return r.fulfill({ json: prefsRecord() });
  });
  await page.route(`${PB}/api/v1/billing`, (r) =>
    r.fulfill({
      json: { plan_type: 'trial', status: 'trial', balance_chf: 2, trial_seed_chf: 2 },
    }),
  );
  await page.route(`${PB}/api/v1/billing/usage`, (r) =>
    r.fulfill({
      json: { period_start: '2026-06-01T00:00:00Z', message_count: 0, by_model: [] },
    }),
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
  await page.route(`${PB}/api/v1/conversations/conv_set/public-key`, (r) =>
    r.fulfill({ json: conversation.conversationPublicKeyRecord }),
  );
  await page.route(`${PB}/api/v1/conversations/conv_set/secret-key`, (r) =>
    r.fulfill({ json: conversation.conversationSecretKeyRecord }),
  );
  await page.route(
    `${PB}/api/v1/conversations/conv_set/messages?page=1&page_size=100`,
    (r) =>
      r.fulfill({
        json: { page: 1, perPage: 100, totalItems: 0, totalPages: 1, items: [] },
      }),
  );
  await page.route(`${PB}/api/v1/conversations/conv_set/redaction-key`, (r) =>
    r.fulfill({ status: 404, contentType: 'application/json', body: '{}' }),
  );
  await page.route(`${PB}/api/v1/conversations/conv_set/redaction-entries`, (r) =>
    r.fulfill({ json: { items: [] } }),
  );

  const composer = page.getByLabel(
    'Message Cognos — stored encrypted; sent to your provider to reply',
  );

  // Default ON: detection flags the email.
  await page.goto('/c/conv_set');
  await expect(page.getByRole('button', { name: 'EU Model' })).toBeVisible();
  await composer.fill('Email jane@example.com please');
  await expect(page.getByText('Redacting 1 sensitive value')).toBeVisible();

  // Turn it off in settings.
  await page.goto('/account');
  await expect(page.getByRole('heading', { name: 'PII redaction' })).toBeVisible();
  await page.getByRole('switch', { name: 'Redact sensitive values' }).click();
  await expect(page.getByText(/Redaction is off/)).toBeVisible();

  // Future messages: detection no longer runs.
  await page.goto('/c/conv_set');
  await expect(page.getByRole('button', { name: 'EU Model' })).toBeVisible();
  await composer.fill('Email jane@example.com please');
  // Give detection its debounce window, then assert nothing is flagged.
  await page.waitForTimeout(400);
  await expect(page.getByText(/Redacting/)).toHaveCount(0);
});
