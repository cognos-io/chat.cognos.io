import { type Page, expect, test } from '@playwright/test';

import {
  buildConversationFixture,
  buildVaultFixture,
  seedAuthenticatedUnlockState,
} from './fixtures';

// Stands up an unlocked conversation whose model declares reasoning-effort
// tiers, so the composer renders the effort selector. Returns a ref to the last
// completion request body so tests can assert what was sent.
async function setupEffortConversation(
  page: Page,
): Promise<{ readonly body: { reasoning_effort?: string } | undefined }> {
  const ref: { body: { reasoning_effort?: string } | undefined } = {
    body: undefined,
  };

  const userFixture = buildVaultFixture('user_e2e_effort', 'effort@example.com');
  const conversationFixture = buildConversationFixture(
    userFixture,
    'conv_e2e_effort',
    'Effort conversation',
  );

  await seedAuthenticatedUnlockState(page, userFixture);

  await page.route('http://localhost:8090/api/v1/user-key-pair', async (route) => {
    await route.fulfill({ json: userFixture.userKeyPairRecord });
  });
  await page.route('http://localhost:8090/api/v1/vault-session', async (route) => {
    await route.fulfill({ json: userFixture.vaultSession });
  });
  await page.route('http://localhost:8090/api/v1/user-preferences', async (route) => {
    if (route.request().method() === 'GET') {
      await route.fulfill({
        status: 404,
        contentType: 'application/json',
        body: JSON.stringify({ message: 'Not found' }),
      });
      return;
    }
    await route.fulfill({ json: { id: 'prefs_1' } });
  });

  await page.route('http://localhost:8090/api/v1/models', async (route) => {
    await route.fulfill({
      json: {
        privacy_tier: 'eu',
        preferred_model_id: 'reasoning-model',
        models: [
          {
            id: 'reasoning-model',
            name: 'Reasoning Model',
            slug: 'reasoning-model',
            provider_id: 'requesty',
            provider_model_id: 'reasoning-model',
            description: 'A model that accepts a reasoning effort',
            privacy_tier: 'eu',
            tags: [{ title: 'reasoning' }],
            content_types: ['text'],
            input_context_tokens: 64000,
            max_output_tokens: 8192,
            pricing: {
              input_usd_per_million_tokens: 1,
              output_usd_per_million_tokens: 2,
            },
            reasoning_efforts: ['off', 'low', 'medium', 'high'],
            default_reasoning_effort: 'medium',
            is_eligible: true,
          },
        ],
      },
    });
  });

  await page.route('http://localhost:8090/api/v1/conversations', async (route) => {
    await route.fulfill({ json: [conversationFixture.conversationRecord] });
  });
  await page.route(
    'http://localhost:8090/api/v1/conversations/conv_e2e_effort/public-key',
    async (route) => {
      await route.fulfill({ json: conversationFixture.conversationPublicKeyRecord });
    },
  );
  await page.route(
    'http://localhost:8090/api/v1/conversations/conv_e2e_effort/secret-key',
    async (route) => {
      await route.fulfill({ json: conversationFixture.conversationSecretKeyRecord });
    },
  );
  await page.route(
    'http://localhost:8090/api/v1/conversations/conv_e2e_effort/messages?page=1&page_size=100',
    async (route) => {
      await route.fulfill({
        json: { page: 1, perPage: 100, totalItems: 0, totalPages: 1, items: [] },
      });
    },
  );
  await page.route(
    'http://localhost:8090/api/v1/conversations/conv_e2e_effort/complete',
    async (route) => {
      ref.body = route.request().postDataJSON() as { reasoning_effort?: string };
      await route.fulfill({
        status: 200,
        headers: { 'content-type': 'text/event-stream' },
        body: `data: ${JSON.stringify({
          type: 'complete',
          response: {
            user_message_id: 'msg_user_effort_1',
            assistant_message: {
              id: 'msg_assistant_effort_1',
              parent_message_id: 'msg_user_effort_1',
              content: 'Done.',
              persona_id: 'cognos:simple-assistant',
              model_id: 'reasoning-model',
              created_at: '2026-06-07T00:00:00Z',
            },
            usage: {
              input_tokens: 1,
              output_tokens: 1,
              total_tokens: 2,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
              reasoning_tokens: 0,
              cost_usd: 0,
              cost_chf: 0,
              cost_rappen: 0,
              used_provider_cost: true,
            },
          },
        })}\n\n`,
      });
    },
  );

  return ref;
}

// The composer surfaces a reasoning-effort selector only for models that
// declare effort tiers, defaults to the model's default, lets the user pick a
// tier, and sends that tier with the completion.
test('composer reasoning-effort selector defaults, switches, and is sent with the completion', async ({
  page,
}) => {
  const request = await setupEffortConversation(page);

  await page.goto('/c/conv_e2e_effort');

  await expect(
    page.getByRole('heading', { name: 'Effort conversation' }),
  ).toBeVisible();

  // The selector shows the model's default tier.
  const effortButton = page.locator('.message-form__reasoning');
  await expect(effortButton).toBeVisible();
  await expect(effortButton).toContainText('Medium');

  // Switch to High.
  await effortButton.click();
  await page.getByRole('menuitemradio', { name: 'High' }).click();
  await expect(effortButton).toContainText('High');

  // Send and confirm the chosen effort travelled with the completion request.
  const composer = page.getByLabel(
    'Message Cognos — stored encrypted; sent to your provider to reply',
  );
  await composer.fill('Think hard about this');
  await page.getByRole('button', { name: 'Send' }).click();

  await expect(page.getByText('Think hard about this')).toBeVisible();
  await expect.poll(() => request.body?.reasoning_effort).toBe('high');
});

// On a narrow (mobile) viewport the effort and tools buttons collapse to
// icon-only — their text labels are dropped to save horizontal space.
test('effort and tools buttons are icon-only on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 800 });
  await setupEffortConversation(page);

  await page.goto('/c/conv_e2e_effort');

  await expect(
    page.getByRole('heading', { name: 'Effort conversation' }),
  ).toBeVisible();

  // Icons remain (so the buttons stay usable) but the text labels are gone.
  const effortButton = page.locator('.message-form__reasoning');
  await expect(effortButton).toBeVisible();
  await expect(effortButton).not.toContainText('Medium');

  const toolsButton = page.locator('.message-form__tools');
  await expect(toolsButton).toBeVisible();
  await expect(toolsButton).not.toContainText('Tools');
  // The control is still reachable by its accessible label.
  await expect(page.getByRole('button', { name: 'Tools' })).toBeVisible();
});
