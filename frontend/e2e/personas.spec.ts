import { expect, test } from '@playwright/test';

import {
  buildConversationFixture,
  buildVaultFixture,
  seedAuthenticatedUnlockState,
} from './fixtures';

const API = 'http://localhost:8090';

test('creates a custom persona as an encrypted browser payload', async ({ page }) => {
  const userFixture = buildVaultFixture('user_e2e_persona', 'persona@example.com');
  const conversationFixture = buildConversationFixture(
    userFixture,
    'conv_e2e_persona',
    'Persona test',
  );

  let createPersonaBody:
    | { data?: string; name?: string; description?: string; slug?: string }
    | undefined;

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

    createPersonaBody = route.request().postDataJSON() as typeof createPersonaBody;
    await route.fulfill({
      status: 201,
      json: {
        id: 'pers_e2e_1',
        created: '2026-06-16 00:00:00.000Z',
        updated: '2026-06-16 00:00:00.000Z',
        collectionId: 'l9i0pyg6kx2m0t5',
        collectionName: 'personas',
        data: createPersonaBody?.data,
        user: userFixture.authState.model.id,
      },
    });
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
    `${API}/api/v1/conversations/conv_e2e_persona/public-key`,
    async (route) => {
      await route.fulfill({ json: conversationFixture.conversationPublicKeyRecord });
    },
  );

  await page.route(
    `${API}/api/v1/conversations/conv_e2e_persona/secret-key`,
    async (route) => {
      await route.fulfill({ json: conversationFixture.conversationSecretKeyRecord });
    },
  );

  await page.route(
    `${API}/api/v1/conversations/conv_e2e_persona/messages?page=1&page_size=100`,
    async (route) => {
      await route.fulfill({
        json: { page: 1, perPage: 100, totalItems: 0, totalPages: 1, items: [] },
      });
    },
  );

  await page.goto('/c/conv_e2e_persona');
  await expect(page.getByRole('heading', { name: 'Persona test' })).toBeVisible();

  await page.getByTitle(/Choose persona/).click();
  await expect(page.getByRole('heading', { name: 'Create your own' })).toBeVisible();

  await page.getByLabel('Name').fill('Private coach');
  await page.getByLabel('Description').fill('Sensitive description');
  await page.getByLabel('Instructions').fill('Sensitive private prompt');
  await page.getByRole('button', { name: 'Save encrypted persona' }).click();

  await expect(
    page.locator('.persona-selector__title', { hasText: 'Private coach' }),
  ).toBeVisible();

  expect(createPersonaBody).toBeTruthy();
  expect(createPersonaBody?.data).toBeTruthy();
  expect(createPersonaBody?.name).toBeUndefined();
  expect(createPersonaBody?.description).toBeUndefined();
  expect(createPersonaBody?.slug).toBeUndefined();
  expect(JSON.stringify(createPersonaBody)).not.toContain('Private coach');
  expect(JSON.stringify(createPersonaBody)).not.toContain('Sensitive description');
  expect(JSON.stringify(createPersonaBody)).not.toContain('Sensitive private prompt');
});
