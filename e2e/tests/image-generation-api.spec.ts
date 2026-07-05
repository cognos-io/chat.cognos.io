import { expect, test } from '@playwright/test';
import { randomBytes } from 'node:crypto';

import { newAnonymousApi, provisionApiUser } from './api-helpers';

// gemini-2-5-flash-image is seeded + whitelisted as image-capable
// (chat_completions transport) by migration 1760000049; the mock AI provider
// returns an inline image for any model id containing "image".
const IMAGE_MODEL_ID = 'gemini-2-5-flash-image';
// A text-only model, used to assert capability enforcement.
const TEXT_MODEL_ID = 'llama-3-3-infomaniak';

// The 1x1 PNG the mock provider returns (mockPNGBase64 in the mock). The stored
// attachment must NEVER equal these plaintext bytes — it is encrypted at rest.
const MOCK_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==',
  'base64',
);

interface ImageModel {
  id: string;
  supports_image_generation?: boolean;
  supports_text_completion?: boolean;
  image_generation_transport?: string;
}

interface GenerateImageResponse {
  request_id?: string;
  user_message_id?: string;
  assistant_message: {
    id: string;
    parent_message_id?: string;
    model_id: string;
    created_at: string;
    attachment?: {
      kind: string;
      mime_type: string;
      file_name: string;
      sealed_key: string;
    };
    content?: string;
  };
}

// The mock returns text (no image) when the prompt contains this marker,
// exercising the graceful text-fallback path (imageTextFallbackReply in the
// mock provider).
const TEXT_FALLBACK_PROMPT = 'draw a fox but reply text-only';
const TEXT_FALLBACK_REPLY =
  "I can't create that image, but here's a description instead.";

const CONVERSATION_DATA = Buffer.from(
  JSON.stringify({ title: 'image generation e2e' }),
).toString('base64');

// Persisted image generation needs a conversation_public_keys row so the
// backend can encrypt the attachment. Key bytes aren't validated (decryption is
// client-side), so a random placeholder is enough — mirrors completions-api.
async function createConversationWithKey(
  user: Awaited<ReturnType<typeof provisionApiUser>>,
): Promise<string> {
  const res = await user.api.post('/api/v1/conversations', {
    data: { data: CONVERSATION_DATA, expiry_duration: '' },
  });
  expect(res.ok(), `conv: ${res.status()} ${await res.text()}`).toBe(true);
  const { id } = (await res.json()) as { id: string };

  const keyRes = await user.api.post(`/api/v1/conversations/${id}/public-key`, {
    data: {
      public_key: randomBytes(32).toString('base64'),
      public_key_signature: randomBytes(32).toString('base64'),
    },
  });
  expect(keyRes.ok(), `public-key: ${keyRes.status()} ${await keyRes.text()}`).toBe(
    true,
  );

  return id;
}

test.describe('image generation API', () => {
  test('models endpoint flags the image model and hides its transport', async () => {
    const user = await provisionApiUser();

    const res = await user.api.get('/api/v1/models');
    expect(res.ok(), `models: ${res.status()}`).toBe(true);
    const body = (await res.json()) as { models: ImageModel[] };

    const image = body.models.find((m) => m.id === IMAGE_MODEL_ID);
    expect(image, 'image model present in catalogue').toBeTruthy();
    expect(image?.supports_image_generation).toBe(true);
    // Image-only: the catalogue must mark it as not text-capable so the
    // composer and the /complete guard both reject text use.
    expect(image?.supports_text_completion).toBe(false);
    // The backend-only routing field must never be exposed to clients.
    expect(image?.image_generation_transport).toBeUndefined();

    const text = body.models.find((m) => m.id === TEXT_MODEL_ID);
    expect(text?.supports_image_generation ?? false).toBe(false);
    expect(text?.supports_text_completion).toBe(true);
  });

  test('generates and persists an encrypted image attachment', async () => {
    const user = await provisionApiUser();
    const conversationID = await createConversationWithKey(user);

    const res = await user.api.post(`/api/v1/conversations/${conversationID}/image`, {
      data: {
        model_id: IMAGE_MODEL_ID,
        prompt: 'a watercolour fox in a top hat',
        request_id: 'img-e2e-1',
      },
    });
    expect(res.ok(), `image: ${res.status()} ${await res.text()}`).toBe(true);
    const body = (await res.json()) as GenerateImageResponse;

    expect(body.assistant_message.id).toBeTruthy();
    const attachment = body.assistant_message.attachment;
    expect(attachment.kind).toBe('generated_image');
    expect(attachment.mime_type).toBe('image/png');
    expect(attachment.file_name).toMatch(/\.enc$/);
    expect(attachment.sealed_key.length).toBeGreaterThan(0);

    // The attachment downloads as ciphertext via the conversation-scoped route,
    // never the plaintext image.
    const fileRes = await user.api.get(
      `/api/v1/conversations/${conversationID}/messages/${body.assistant_message.id}/attachment`,
    );
    expect(fileRes.ok(), `attachment: ${fileRes.status()}`).toBe(true);
    const bytes = await fileRes.body();
    expect(bytes.length).toBeGreaterThan(0);
    expect(bytes.equals(MOCK_PNG), 'stored attachment must be encrypted').toBe(false);
    // PNG magic header must not appear — the file starts with a secretbox nonce.
    expect(bytes.subarray(0, 4).equals(MOCK_PNG.subarray(0, 4))).toBe(false);
  });

  test('falls back to a text message when the model returns text, not an image', async () => {
    const user = await provisionApiUser();
    const conversationID = await createConversationWithKey(user);

    const res = await user.api.post(`/api/v1/conversations/${conversationID}/image`, {
      data: {
        model_id: IMAGE_MODEL_ID,
        prompt: TEXT_FALLBACK_PROMPT,
        request_id: 'img-text-e2e-1',
      },
    });
    // A text answer to an image request is a success, not the old 503.
    expect(res.ok(), `image-text: ${res.status()} ${await res.text()}`).toBe(true);
    const body = (await res.json()) as GenerateImageResponse;

    // The reply is a normal assistant message: text content, no attachment.
    expect(body.assistant_message.content).toBe(TEXT_FALLBACK_REPLY);
    expect(body.assistant_message.attachment).toBeUndefined();
    // The prompt was still persisted as a user message the reply is parented to.
    expect(body.user_message_id).toBeTruthy();
    expect(body.assistant_message.parent_message_id).toBe(body.user_message_id);
  });

  test('rejects a text-only model before calling the provider', async () => {
    const user = await provisionApiUser();
    const conversationID = await createConversationWithKey(user);

    const res = await user.api.post(`/api/v1/conversations/${conversationID}/image`, {
      data: { model_id: TEXT_MODEL_ID, prompt: 'a fox' },
    });
    expect(res.status()).toBe(400);
    expect(await res.text()).toContain('does not support image generation');
  });

  test('regenerates a sibling image without creating a new user message', async () => {
    const user = await provisionApiUser();
    const conversationID = await createConversationWithKey(user);

    const first = await user.api.post(`/api/v1/conversations/${conversationID}/image`, {
      data: { model_id: IMAGE_MODEL_ID, prompt: 'a watercolour fox' },
    });
    expect(first.ok(), `first: ${first.status()} ${await first.text()}`).toBe(true);
    const firstBody = (await first.json()) as GenerateImageResponse;
    const promptMessageId = firstBody.user_message_id;
    expect(promptMessageId, 'first generation creates a user message').toBeTruthy();

    const regen = await user.api.post(`/api/v1/conversations/${conversationID}/image`, {
      data: {
        model_id: IMAGE_MODEL_ID,
        prompt: 'a watercolour fox',
        parent_message_id: promptMessageId,
      },
    });
    expect(regen.ok(), `regen: ${regen.status()} ${await regen.text()}`).toBe(true);
    const regenBody = (await regen.json()) as GenerateImageResponse;

    // The regenerated image is parented to the existing prompt, and no new user
    // message was created.
    expect(regenBody.assistant_message.parent_message_id).toBe(promptMessageId);
    expect(regenBody.user_message_id ?? '').toBe('');
  });

  test('attachment download requires authentication', async () => {
    const anonApi = await newAnonymousApi();
    const res = await anonApi.get(
      `/api/v1/conversations/whatever/messages/whatever/attachment`,
    );
    expect(res.status()).toBe(401);
  });
});
