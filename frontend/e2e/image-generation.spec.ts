import { expect, test } from '@playwright/test';

import {
  buildConversationFixture,
  buildImageAttachmentFixture,
  buildVaultFixture,
  seedAuthenticatedUnlockState,
} from './fixtures';

const CONVERSATION_ID = 'conv_e2e_image';

// A 1x1 PNG — the "generated image" the mocked endpoint returns, encrypted to
// the conversation key so the app decrypts and renders it.
const PNG_BYTES = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

// Catalogue with an eligible text model (default) and an eligible image model.
function modelsPayload() {
  const base = {
    slug: 'm',
    provider_id: 'requesty',
    provider_model_id: 'm',
    description: 'A model',
    privacy_tier: 'eu',
    tags: [],
    content_types: ['text'],
    input_context_tokens: 64000,
    max_output_tokens: 8192,
    pricing: { input_usd_per_million_tokens: 1, output_usd_per_million_tokens: 2 },
    is_eligible: true,
  };
  return {
    privacy_tier: 'eu',
    preferred_model_id: 'text-model',
    models: [
      {
        ...base,
        id: 'text-model',
        name: 'Sovereign Text',
        supports_image_generation: false,
      },
      {
        ...base,
        id: 'image-model',
        name: 'Flash Image',
        supports_image_generation: true,
        // Image-only (like gemini-2.5-flash-image): can't do text completion.
        supports_text_completion: false,
      },
    ],
  };
}

test.describe('image generation', () => {
  test.beforeEach(async ({ page }) => {
    const userFixture = buildVaultFixture('user_e2e_image', 'image@example.com');
    const conversationFixture = buildConversationFixture(
      userFixture,
      CONVERSATION_ID,
      'Image conversation',
    );
    const attachment = buildImageAttachmentFixture(conversationFixture, PNG_BYTES);

    await seedAuthenticatedUnlockState(page, userFixture);

    await page.route('http://localhost:8090/api/v1/user-key-pair', (route) =>
      route.fulfill({ json: userFixture.userKeyPairRecord }),
    );
    await page.route('http://localhost:8090/api/v1/vault-session', (route) =>
      route.fulfill({ json: userFixture.vaultSession }),
    );
    await page.route('http://localhost:8090/api/v1/user-preferences', (route) =>
      route.fulfill({ status: 404, json: { message: 'Not found' } }),
    );
    await page.route('http://localhost:8090/api/v1/models', (route) =>
      route.fulfill({ json: modelsPayload() }),
    );
    await page.route('http://localhost:8090/api/v1/conversations', (route) =>
      route.fulfill({ json: [conversationFixture.conversationRecord] }),
    );
    await page.route(
      `http://localhost:8090/api/v1/conversations/${CONVERSATION_ID}/public-key`,
      (route) =>
        route.fulfill({ json: conversationFixture.conversationPublicKeyRecord }),
    );
    await page.route(
      `http://localhost:8090/api/v1/conversations/${CONVERSATION_ID}/secret-key`,
      (route) =>
        route.fulfill({ json: conversationFixture.conversationSecretKeyRecord }),
    );
    await page.route(
      `http://localhost:8090/api/v1/conversations/${CONVERSATION_ID}/messages?page=1&page_size=100`,
      (route) =>
        route.fulfill({
          json: { page: 1, perPage: 100, totalItems: 0, totalPages: 1, items: [] },
        }),
    );

    // Image generation endpoint: return an encrypted attachment the app can
    // decrypt. Honour parent_message_id so regenerate is exercised too.
    await page.route(
      `http://localhost:8090/api/v1/conversations/${CONVERSATION_ID}/image`,
      (route) => {
        const body = route.request().postDataJSON() as {
          request_id?: string;
          parent_message_id?: string;
        };
        const regenerate = !!body.parent_message_id;
        const parentId = body.parent_message_id ?? 'msg_user_img';
        route.fulfill({
          json: {
            request_id: body.request_id,
            user_message_id: regenerate ? undefined : 'msg_user_img',
            assistant_message: {
              id: regenerate ? 'msg_assistant_img_2' : 'msg_assistant_img_1',
              parent_message_id: parentId,
              model_id: 'image-model',
              created_at: '2026-06-22T00:00:00Z',
              attachment: {
                kind: 'generated_image',
                mime_type: 'image/png',
                file_name: 'image.enc',
                sealed_key: attachment.sealedKeyBase64,
              },
            },
            usage: {
              input_tokens: 7,
              output_tokens: 1303,
              total_tokens: 1310,
              cache_creation_input_tokens: 0,
              cache_read_input_tokens: 0,
              cost_usd: 0.04,
              cost_chf: 0.04,
              cost_rappen: 4,
              used_provider_cost: true,
            },
          },
        });
      },
    );

    // Attachment download: the encrypted bytes for any message in this conversation.
    await page.route(
      `http://localhost:8090/api/v1/conversations/${CONVERSATION_ID}/messages/*/attachment`,
      (route) =>
        route.fulfill({
          contentType: 'application/octet-stream',
          body: Buffer.from(attachment.ciphertext),
        }),
    );

    await page.goto(`/c/${CONVERSATION_ID}`);
    await expect(page.getByRole('button', { name: 'Sovereign Text' })).toBeVisible();
  });

  test('auto-switches to an image model and filters the selector when the tool is on', async ({
    page,
  }) => {
    await page.getByRole('button', { name: 'Tools' }).click();
    await page.getByRole('switch', { name: 'Generate image' }).click();
    // Close the tools menu so its backdrop doesn't swallow the next click.
    await page.keyboard.press('Escape');

    // The composer auto-switched the selected model to the image-capable one
    // (the trigger now shows it) and announced the switch.
    await expect(page.getByRole('button', { name: 'Flash Image' })).toBeVisible();
    await expect(page.getByText(/Switched to .*Flash Image/i)).toBeVisible();

    // The model selector now lists only image-capable models.
    await page.getByRole('button', { name: 'Flash Image' }).click();
    await expect(
      page.getByRole('listbox', { name: 'Pick your AI model' }),
    ).toBeVisible();
    await expect(page.getByRole('option', { name: /Flash Image/ })).toBeVisible();
    await expect(page.getByRole('option', { name: /Sovereign Text/ })).toHaveCount(0);
  });

  test('switches back to the chat model when the image tool is turned off', async ({
    page,
  }) => {
    await page.getByRole('button', { name: 'Tools' }).click();
    await page.getByRole('switch', { name: 'Generate image' }).click();
    await expect(page.getByRole('button', { name: 'Flash Image' })).toBeVisible();

    // Turning the tool back off returns to the chat model — no image-only model
    // is left selected for text (the bug this feature fixes).
    await page.getByRole('switch', { name: 'Generate image' }).click();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Sovereign Text' })).toBeVisible();
  });

  test('generates and renders a decrypted image', async ({ page }) => {
    await page.getByRole('button', { name: 'Tools' }).click();
    await page.getByRole('switch', { name: 'Generate image' }).click();
    // The composer auto-switched to the image model; no manual pick needed.
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: 'Flash Image' })).toBeVisible();

    const composer = page.getByLabel(
      'Message Cognos — stored encrypted; sent to your provider to reply',
    );
    await composer.fill('a watercolour fox in a top hat');
    await page.getByRole('button', { name: 'Send' }).click();

    // The prompt renders as a user message, and the decrypted image renders in
    // the assistant message (a blob: image, proving the full decrypt path).
    await expect(page.getByText('a watercolour fox in a top hat')).toBeVisible();
    const image = page.locator('.message-list-item__assistant img').last();
    await expect(image).toBeVisible();
    await expect(image).toHaveJSProperty('complete', true);
    await expect(image).toHaveAttribute('src', /^blob:/);
  });
});
