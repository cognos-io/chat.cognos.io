import { Page, expect, test } from '@playwright/test';

import {
  type ConversationFixture,
  type VaultFixture,
  buildConversationFixture,
  buildVaultFixture,
  seedAuthenticatedUnlockState,
} from './fixtures';

// Browser e2e for "Duplicate chat". The end-to-end crypto/graph correctness is
// proven in the API suite (e2e/tests/conversation-copy-api.spec.ts) and the
// service unit tests; here we drive the real UI against a mocked backend to
// verify the user-visible behaviour: the menus, the blocking loading state with
// its keep-tab-open warning, navigation + success toast, and the failure path.

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
      pricing: { input_usd_per_million_tokens: 1, output_usd_per_million_tokens: 2 },
      is_eligible: true,
    },
  ],
};

type CopyHandler = (body: { conversation: { id: string } }) => {
  status: number;
  json?: unknown;
};

// seedDuplicateRoutes wires every backend call the duplicate flow makes. The
// source conversation has no messages, so the copy bundle is empty — enough to
// exercise the UI orchestration end to end (the message re-encryption itself is
// covered by the API/unit suites). `copyHandler` decides the POST /copies
// outcome per test.
const seedDuplicateRoutes = async (
  page: Page,
  userFixture: VaultFixture,
  source: ConversationFixture,
  copyHandler: CopyHandler,
) => {
  await seedAuthenticatedUnlockState(page, userFixture);

  // Catch-all 404 first (lowest precedence) so an unmocked call returns JSON
  // instead of escaping to a real network the mock backend isn't serving.
  await page.route('**/api/v1/**', async (route) => {
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });

  await page.route('**/api/v1/user-key-pair', async (route) => {
    await route.fulfill({ json: userFixture.userKeyPairRecord });
  });
  await page.route('**/api/v1/vault-session', async (route) => {
    await route.fulfill({ json: userFixture.vaultSession });
  });
  await page.route('**/api/v1/user-preferences', async (route) => {
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });
  await page.route('**/api/v1/models', async (route) => {
    await route.fulfill({ json: modelsCatalogue });
  });
  await page.route('**/api/v1/conversations', async (route) => {
    await route.fulfill({ json: [source.conversationRecord] });
  });

  // Any conversation's messages → empty (the source genuinely has none, and the
  // duplicate renders empty after navigation).
  await page.route('**/api/v1/conversations/*/messages**', async (route) => {
    await route.fulfill({
      json: { page: 1, perPage: 100, totalItems: 0, totalPages: 1, items: [] },
    });
  });

  // No redaction on the source.
  await page.route('**/api/v1/conversations/*/redaction-key', async (route) => {
    await route.fulfill({ status: 404, contentType: 'application/json', body: '{}' });
  });

  const id = source.conversationRecord.id;
  await page.route(`**/api/v1/conversations/${id}/public-key`, async (route) => {
    await route.fulfill({ json: source.conversationPublicKeyRecord });
  });
  await page.route(`**/api/v1/conversations/${id}/secret-key`, async (route) => {
    await route.fulfill({ json: source.conversationSecretKeyRecord });
  });

  await page.route(`**/api/v1/conversations/${id}/copies`, async (route) => {
    const body = route.request().postDataJSON() as { conversation: { id: string } };
    const result = copyHandler(body);
    if (result.json !== undefined) {
      await route.fulfill({ status: result.status, json: result.json });
    } else {
      await route.fulfill({
        status: result.status,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'failed' }),
      });
    }
  });
};

// A successful copy echoes the client-generated id so navigation is to the real
// duplicate route.
const successResponse: CopyHandler = (body) => ({
  status: 201,
  json: {
    conversation: {
      id: body.conversation.id,
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      data: 'AAAA',
      key_version: 1,
      last_activity_at: new Date().toISOString(),
    },
    message_count: 0,
  },
});

test.use({ viewport: { width: 1280, height: 720 } });

test('sidebar menu duplicates a chat, shows the blocking loading state, then navigates with a success toast', async ({
  page,
}) => {
  const userFixture = buildVaultFixture('user_e2e', 'e2e@example.com');
  const source = buildConversationFixture(
    userFixture,
    'convdupsource01',
    'Rabbit hole',
  );

  // Gate the copy response so we can observe the loading dialog mid-flight.
  let releaseCopy: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => (releaseCopy = resolve));
  await seedDuplicateRoutes(page, userFixture, source, successResponse);
  await page.route('**/api/v1/conversations/convdupsource01/copies', async (route) => {
    await gate;
    const body = route.request().postDataJSON() as { conversation: { id: string } };
    await route.fulfill({ status: 201, json: successResponse(body).json });
  });

  await page.goto('/c/convdupsource01');
  await expect(page.getByRole('heading', { name: 'Rabbit hole' })).toBeVisible();

  // Open the sidebar item's overflow menu and choose Duplicate chat.
  await page.getByRole('button', { name: 'Open conversation menu' }).first().click();
  await page.getByRole('menuitem', { name: 'Duplicate chat' }).click();

  // The blocking loading state appears with the keep-tab-open warning.
  await expect(page.getByText('Duplicating chat…')).toBeVisible();
  await expect(
    page.getByText(/Keep this tab open\. Closing or reloading/i),
  ).toBeVisible();

  // Let the copy complete: success toast, navigation to the duplicate, dialog gone.
  releaseCopy();
  await expect(page.getByText('Chat duplicated')).toBeVisible();
  await expect(page).toHaveURL(/\/c\/.+/);
  await expect(page).not.toHaveURL(/\/c\/convdupsource01$/);
  await expect(page.getByText('Duplicating chat…')).toBeHidden();
});

test('the conversation header menu also offers Duplicate chat and duplicates', async ({
  page,
}) => {
  const userFixture = buildVaultFixture('user_e2e', 'e2e@example.com');
  const source = buildConversationFixture(
    userFixture,
    'convdupheader01',
    'Header copy',
  );

  await seedDuplicateRoutes(page, userFixture, source, successResponse);

  await page.goto('/c/convdupheader01');
  await expect(page.getByRole('heading', { name: 'Header copy' })).toBeVisible();

  await page.getByRole('button', { name: 'Conversation menu', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Duplicate chat' }).click();

  await expect(page.getByText('Chat duplicated')).toBeVisible();
  await expect(page).toHaveURL(/\/c\/.+/);
  await expect(page).not.toHaveURL(/\/c\/convdupheader01$/);
});

test('a failed duplicate leaves the user on the source chat and shows a translated error', async ({
  page,
}) => {
  const userFixture = buildVaultFixture('user_e2e', 'e2e@example.com');
  const source = buildConversationFixture(userFixture, 'convdupfail0001', 'Stays put');

  await seedDuplicateRoutes(page, userFixture, source, () => ({ status: 500 }));

  await page.goto('/c/convdupfail0001');
  await expect(page.getByRole('heading', { name: 'Stays put' })).toBeVisible();

  await page.getByRole('button', { name: 'Open conversation menu' }).first().click();
  await page.getByRole('menuitem', { name: 'Duplicate chat' }).click();

  // Generic, content-free error; the user stays on the source conversation.
  await expect(page.getByText(/Couldn't duplicate this chat/i)).toBeVisible();
  await expect(page).toHaveURL(/\/c\/convdupfail0001$/);
  await expect(page.getByText('Duplicating chat…')).toBeHidden();
});
