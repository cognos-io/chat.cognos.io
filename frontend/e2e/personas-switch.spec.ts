import { expect, test } from '@playwright/test';

import {
  buildConversationFixture,
  buildVaultFixture,
  seedAuthenticatedUnlockState,
} from './fixtures';

const API = 'http://localhost:8090';

test('switches persona multiple times within one conversation', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));

  const userFixture = buildVaultFixture('user_e2e_switch', 'switch@example.com');
  const conversationFixture = buildConversationFixture(
    userFixture,
    'conv_e2e_switch',
    'Switch test',
  );

  await seedAuthenticatedUnlockState(page, userFixture);

  await page.route(`${API}/api/v1/user-key-pair`, async (route) => {
    await route.fulfill({ json: userFixture.userKeyPairRecord });
  });
  await page.route(`${API}/api/v1/vault-session`, async (route) => {
    await route.fulfill({ json: userFixture.vaultSession });
  });
  await page.route(`${API}/api/v1/user-preferences`, async (route) => {
    await route.fulfill({
      status: 404,
      contentType: 'application/json',
      body: JSON.stringify({ message: 'Not found' }),
    });
  });
  await page.route(`${API}/api/v1/personas`, async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({ json: { items: [] } });
      return;
    }
    await route.fulfill({ status: 201, json: { items: [] } });
  });

  await page.route(`${API}/api/v1/models`, async (route) => {
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

  await page.route(`${API}/api/v1/conversations`, async (route) => {
    await route.fulfill({ json: [conversationFixture.conversationRecord] });
  });
  await page.route(
    `${API}/api/v1/conversations/conv_e2e_switch/public-key`,
    async (route) => {
      await route.fulfill({ json: conversationFixture.conversationPublicKeyRecord });
    },
  );
  await page.route(
    `${API}/api/v1/conversations/conv_e2e_switch/secret-key`,
    async (route) => {
      await route.fulfill({ json: conversationFixture.conversationSecretKeyRecord });
    },
  );
  await page.route(
    `${API}/api/v1/conversations/conv_e2e_switch/messages?page=1&page_size=100`,
    async (route) => {
      await route.fulfill({
        json: { page: 1, perPage: 100, totalItems: 0, totalPages: 1, items: [] },
      });
    },
  );

  const sentPersonaIds: string[] = [];
  let replyCounter = 0;
  await page.route(
    `${API}/api/v1/conversations/conv_e2e_switch/complete`,
    async (route) => {
      const body = route.request().postDataJSON() as { persona_id: string };
      sentPersonaIds.push(body.persona_id);
      replyCounter += 1;
      const id = replyCounter;
      await route.fulfill({
        contentType: 'text/event-stream',
        body: [
          `data: ${JSON.stringify({ type: 'delta', delta: `Reply ${id}` })}`,
          '',
          `data: ${JSON.stringify({
            type: 'complete',
            response: {
              user_message_id: `msg_user_${id}`,
              assistant_message: {
                id: `msg_assistant_${id}`,
                parent_message_id: `msg_user_${id}`,
                content: `Reply ${id}`,
                persona_id: body.persona_id,
                model_id: 'eu-model',
                created_at: '2026-06-07T00:00:00Z',
              },
              usage: {
                input_tokens: 12,
                output_tokens: 8,
                total_tokens: 20,
                cache_creation_input_tokens: 0,
                cache_read_input_tokens: 0,
                cost_usd: 0.02,
                cost_chf: 0.02,
                cost_rappen: 2,
                used_provider_cost: true,
              },
            },
          })}`,
          '',
        ].join('\n'),
      });
    },
  );

  await page.goto('/c/conv_e2e_switch');
  await expect(page.getByRole('heading', { name: 'Switch test' })).toBeVisible();

  const composer = page.getByLabel('Message Cognos — encrypted on this device');

  // Turn 1 — default persona (Simple Assistant)
  await composer.fill('First message');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('Reply 1')).toBeVisible();

  // Switch to Direct
  await page.getByTitle(/Choose persona/).click();
  await page.getByText('Direct', { exact: true }).click();
  await page.getByRole('button', { name: 'Select' }).click();

  // Turn 2 — Direct persona
  await composer.fill('Second message');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('Reply 2')).toBeVisible();

  // Switch to Technical Partner
  await page.getByTitle(/Choose persona/).click();
  await page.getByText('Technical Partner', { exact: true }).click();
  await page.getByRole('button', { name: 'Select' }).click();

  // Turn 3 — Technical Partner persona
  await composer.fill('Third message');
  await page.getByRole('button', { name: 'Send' }).click();
  await expect(page.getByText('Reply 3')).toBeVisible();

  expect(sentPersonaIds).toEqual([
    'cognos:simple-assistant',
    'cognos:direct',
    'cognos:technical-partner',
  ]);
  expect(pageErrors).toEqual([]);
});
