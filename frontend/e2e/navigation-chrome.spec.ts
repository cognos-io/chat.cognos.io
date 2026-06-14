import { expect, test } from '@playwright/test';

import { buildVaultFixture, seedAuthenticatedUnlockState } from './fixtures';

const seedChatRoutes = async (
  page: Parameters<typeof seedAuthenticatedUnlockState>[0] & {
    route: (...args: never[]) => Promise<void>;
  },
  userFixture: ReturnType<typeof buildVaultFixture>,
) => {
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
    await route.fulfill({ json: [] });
  });
};

const menuButton = (page: import('@playwright/test').Page) =>
  page.getByRole('button', { name: 'Open navigation' });

test('desktop chat shell hides the mobile top bar and shows the sidebar', async ({
  page,
}) => {
  const userFixture = buildVaultFixture('user_e2e', 'e2e@example.com');
  await seedChatRoutes(page, userFixture);

  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');

  await expect(page.getByRole('button', { name: 'New chat' })).toBeVisible();
  await expect(menuButton(page)).toBeHidden();
});

test('mobile chat shell shows the hamburger menu', async ({ page }) => {
  const userFixture = buildVaultFixture('user_e2e', 'e2e@example.com');
  await seedChatRoutes(page, userFixture);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  await expect(menuButton(page)).toBeVisible();
});
