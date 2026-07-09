import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

import {
  buildConversationFixture,
  buildVaultFixture,
  seedAuthenticatedUnlockState,
} from './fixtures';

const modelsCatalogue = {
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
};

const seedChatRoutes = async (
  page: Parameters<typeof seedAuthenticatedUnlockState>[0] & {
    route: (...args: never[]) => Promise<void>;
  },
  userFixture: ReturnType<typeof buildVaultFixture>,
  conversations: ReturnType<typeof buildConversationFixture>[] = [],
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
    await route.fulfill({ json: modelsCatalogue });
  });

  await page.route('http://localhost:8090/api/v1/conversations', async (route) => {
    await route.fulfill({
      json: conversations.map((conversation) => conversation.conversationRecord),
    });
  });

  for (const conversation of conversations) {
    const id = conversation.conversationRecord.id;

    await page.route(
      `http://localhost:8090/api/v1/conversations/${id}/public-key`,
      async (route) => {
        await route.fulfill({ json: conversation.conversationPublicKeyRecord });
      },
    );

    await page.route(
      `http://localhost:8090/api/v1/conversations/${id}/secret-key`,
      async (route) => {
        await route.fulfill({ json: conversation.conversationSecretKeyRecord });
      },
    );

    await page.route(
      `http://localhost:8090/api/v1/conversations/${id}/messages?page=1&page_size=100`,
      async (route) => {
        await route.fulfill({
          json: { page: 1, perPage: 100, totalItems: 0, totalPages: 1, items: [] },
        });
      },
    );
  }
};

test('skip link moves focus to the main landmark', async ({ page }) => {
  const userFixture = buildVaultFixture('user_a11y_skip', 'a11y-skip@example.com');
  await seedChatRoutes(page, userFixture);
  await page.goto('/');

  const skipLink = page.getByRole('link', { name: 'Skip to main content' });
  await skipLink.focus();
  await expect(skipLink).toBeFocused();

  await skipLink.click();
  await expect(page.locator('#main-content')).toBeVisible();
  await expect(page).toHaveURL(/#main-content$/);
});

test('CDK dialog exposes an accessible name from its title', async ({ page }) => {
  const userFixture = buildVaultFixture('user_a11y_dialog', 'a11y-dialog@example.com');
  const conversation = buildConversationFixture(
    userFixture,
    'conv_a11y_dialog',
    'Accessibility dialog',
  );

  await seedChatRoutes(page, userFixture, [conversation]);

  await page.route(
    `http://localhost:8090/api/v1/conversations/${conversation.conversationRecord.id}/public-share`,
    async (route) => {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'not shared' }),
      });
    },
  );

  await page.goto('/c/conv_a11y_dialog');
  await expect(page.getByRole('button', { name: 'Share' })).toBeEnabled();

  await page.getByRole('button', { name: 'Share' }).click();

  const dialog = page.getByRole('dialog', { name: 'Share conversation' });
  await expect(dialog).toBeVisible();

  const accessibilityScanResults = await new AxeBuilder({ page })
    .include('.cdk-overlay-pane')
    .analyze();
  expect(accessibilityScanResults.violations).toEqual([]);

  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();
});

test('mobile navigation drawer traps keyboard focus', async ({ page }) => {
  const userFixture = buildVaultFixture('user_a11y_trap', 'a11y-trap@example.com');
  await seedChatRoutes(page, userFixture);

  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');

  await page.getByRole('button', { name: 'Open navigation' }).click();

  const drawer = page.locator('.cog-drawer__panel');
  await expect(drawer).toBeVisible();

  const focusedInsideDrawer = async (): Promise<boolean> => {
    return page.evaluate(() => {
      const panel = document.querySelector('.cog-drawer__panel');
      const active = document.activeElement;
      return Boolean(panel && active && panel.contains(active));
    });
  };

  expect(await focusedInsideDrawer()).toBe(true);

  for (let i = 0; i < 12; i++) {
    await page.keyboard.press('Tab');
    expect(await focusedInsideDrawer()).toBe(true);
  }

  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
});
