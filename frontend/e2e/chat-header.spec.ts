import { expect, test } from '@playwright/test';
import { blake2b } from 'blakejs';

import {
  type ConversationFixture,
  type VaultFixture,
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
};

// The header formats the vault's canonical fingerprint — base64(blake2b(publicKey))
// — into three groups of four uppercase hex characters. Derive the expected
// display value straight from the fixture key so the test exercises the real path.
const expectedFingerprint = (publicKey: Uint8Array): string => {
  const hex = Array.from(blake2b(publicKey, undefined, 32).slice(0, 6))
    .map((byte) => byte.toString(16).padStart(2, '0').toUpperCase())
    .join('');

  return hex.match(/.{1,4}/g)?.join(' · ') ?? hex;
};

const seedChatRoutes = async (
  page: Parameters<typeof seedAuthenticatedUnlockState>[0] & {
    route: (...args: never[]) => Promise<void>;
  },
  userFixture: VaultFixture,
  conversations: ConversationFixture[] = [],
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

test.use({ viewport: { width: 1280, height: 720 } });

test('persisted conversation header exposes the title, menu, share and security', async ({
  page,
}) => {
  const userFixture = buildVaultFixture('user_e2e', 'e2e@example.com');
  const conversationFixture = buildConversationFixture(
    userFixture,
    'conv_e2e_header',
    'FOI request — draft reply',
  );

  await seedChatRoutes(page, userFixture, [conversationFixture]);
  await page.goto('/c/conv_e2e_header');

  // Title renders as the page heading.
  await expect(
    page.getByRole('heading', { name: 'FOI request — draft reply' }),
  ).toBeVisible();

  // Share is active for a persisted conversation and opens the share dialog.
  await expect(page.getByRole('button', { name: 'Share' })).toBeEnabled();

  // The overflow menu offers rename, a disabled export and delete.
  await page.getByRole('button', { name: 'Conversation menu', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Rename' })).toBeVisible();
  // Export is enabled at rest (it only disables mid-export).
  await expect(page.getByRole('button', { name: /Export/ })).toBeEnabled();
  await expect(page.getByRole('button', { name: 'Duplicate chat' })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Delete' })).toBeVisible();

  // Dismiss the menu before opening the modal.
  await page.keyboard.press('Escape');
  await page.getByRole('heading', { name: 'FOI request — draft reply' }).click();
});

test('security modal shows the real device key fingerprint', async ({ page }) => {
  const userFixture = buildVaultFixture('user_e2e', 'e2e@example.com');
  const conversationFixture = buildConversationFixture(
    userFixture,
    'conv_e2e_header',
    'FOI request — draft reply',
  );

  await seedChatRoutes(page, userFixture, [conversationFixture]);
  await page.goto('/c/conv_e2e_header');

  await page.getByRole('button', { name: 'Security & keys' }).click();

  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading', { name: 'Security & keys' })).toBeVisible();
  await expect(dialog.getByText('Encrypted on this device')).toBeVisible();
  await expect(dialog.getByText('Device key')).toBeVisible();
  await expect(
    dialog.getByText(expectedFingerprint(userFixture.userKeyPair.publicKey)),
  ).toBeVisible();
  await expect(dialog.getByText('Verified')).toBeVisible();

  await dialog.getByRole('button', { name: 'Got it' }).click();
  await expect(page.getByRole('heading', { name: 'Security & keys' })).toBeHidden();
});

test('the security modal body scrolls when its content is taller than the viewport', async ({
  page,
}) => {
  const userFixture = buildVaultFixture('user_e2e', 'e2e@example.com');
  const conversationFixture = buildConversationFixture(
    userFixture,
    'conv_e2e_header',
    'Scroll check',
  );

  await seedChatRoutes(page, userFixture, [conversationFixture]);
  // A short viewport forces the modal content past the panel height.
  await page.setViewportSize({ width: 460, height: 640 });
  await page.goto('/c/conv_e2e_header');

  await page.getByRole('button', { name: 'Security & keys' }).click();

  const body = page.locator('.cog-modal__body');
  await expect(body).toBeVisible();

  // The body is the scroll container — content overflows it rather than the
  // panel clipping silently (the bug this guards against).
  const overflow = await body.evaluate((el) => el.scrollHeight - el.clientHeight);
  expect(overflow).toBeGreaterThan(0);

  // And it genuinely scrolls: starts at the top, reaches the bottom content.
  expect(await body.evaluate((el) => el.scrollTop)).toBe(0);
  await body.evaluate((el) => el.scrollTo(0, el.scrollHeight));
  expect(await body.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
});

test('new chat header has no overflow menu', async ({ page }) => {
  const userFixture = buildVaultFixture('user_e2e', 'e2e@example.com');

  await seedChatRoutes(page, userFixture);
  await page.goto('/');

  await expect(page.getByRole('heading', { name: 'New chat' })).toBeVisible();
  await expect(
    page.getByRole('button', { name: 'Conversation menu', exact: true }),
  ).toBeHidden();
  await expect(page.getByRole('button', { name: 'Security & keys' })).toBeVisible();
});
