import { expect, test } from '@playwright/test';
import { randomBytes } from 'node:crypto';

import { provisionApiUser } from './api-helpers';
import { authBox, generateKeyPair, sealFor, utf8 } from './crypto-helpers';

// gemini-2-5-flash-image is seeded image-capable; the mock provider returns an
// inline image for any model id containing "image".
const IMAGE_MODEL_ID = 'gemini-2-5-flash-image';

// End-to-end proof that a generated image survives the public-share boundary and
// renders for an anonymous viewer.
//
// The conversation, generated image, and public share are set up through the
// real API with real client-side crypto (image generation isn't plan-gated at
// the API, and the share fragment secret is generated here exactly as the
// browser would). Then a fresh, unauthenticated browser opens /p/<token>#<key>
// and must DECRYPT and RENDER the image — exercising the token-gated public
// attachment endpoint and the public-conversation view, rather than the old
// "empty message" fallback. Only the share token + ciphertext ever touch the
// server; the fragment key never leaves the URL.
test.describe('public share images', () => {
  test('an anonymous viewer decrypts and sees a shared generated image', async ({
    page,
  }) => {
    const owner = await provisionApiUser();
    try {
      // 1. A conversation with real crypto so the anonymous reader can decrypt
      //    the title, and a public key the server seals the image to.
      const conversationKeys = generateKeyPair();
      const data = authBox(
        conversationKeys.publicKey,
        conversationKeys.secretKey,
        utf8.encode(JSON.stringify({ title: 'Generated art' })),
      );
      const createConv = await owner.api.post('/api/v1/conversations', {
        data: { data, expiry_duration: '' },
      });
      expect(
        createConv.ok(),
        `create conv: ${createConv.status()} ${await createConv.text()}`,
      ).toBe(true);
      const { id: conversationId } = (await createConv.json()) as { id: string };

      const publicKeyRes = await owner.api.post(
        `/api/v1/conversations/${conversationId}/public-key`,
        {
          data: {
            public_key: conversationKeys.publicKey,
            public_key_signature: randomBytes(32).toString('base64'),
          },
        },
      );
      expect(
        publicKeyRes.ok(),
        `public-key: ${publicKeyRes.status()} ${await publicKeyRes.text()}`,
      ).toBe(true);

      // 2. Generate an image — the server encrypts it and seals the per-image
      //    key to the conversation public key.
      const imageRes = await owner.api.post(
        `/api/v1/conversations/${conversationId}/image`,
        {
          data: {
            model_id: IMAGE_MODEL_ID,
            prompt: 'a banana on a sunny beach',
            request_id: 'pub-share-img-1',
          },
        },
      );
      expect(
        imageRes.ok(),
        `image: ${imageRes.status()} ${await imageRes.text()}`,
      ).toBe(true);

      // 3. Publish a public link: the fragment secret is generated here and
      //    never sent to the server (only the wrapped/sealed forms are).
      const publicShareKeys = generateKeyPair();
      const shareRes = await owner.api.post(
        `/api/v1/conversations/${conversationId}/public-share`,
        {
          data: {
            public_key: publicShareKeys.publicKey,
            wrapped_conversation_secret_key: sealFor(
              publicShareKeys.publicKey,
              Buffer.from(conversationKeys.secretKey, 'base64'),
            ),
            share_secret: sealFor(
              conversationKeys.publicKey,
              Buffer.from(publicShareKeys.secretKey, 'base64'),
            ),
          },
        },
      );
      expect(
        shareRes.ok(),
        `share: ${shareRes.status()} ${await shareRes.text()}`,
      ).toBe(true);
      const { token } = (await shareRes.json()) as { token: string };

      // 4. The URL the client would build: /p/<token>#<url-safe base64 secret>.
      const fragment = Buffer.from(publicShareKeys.secretKey, 'base64').toString(
        'base64url',
      );
      const shareUrl = `/p/${token}#${fragment}`;

      // 5. Open it as a brand-new anonymous viewer (the page carries no auth).
      await page.goto(shareUrl);

      const image = page.locator('cog-image-grid img').first();
      await expect(image).toBeVisible({ timeout: 20_000 });
      await expect(image).toHaveAttribute('src', /^blob:/);

      // The image-only message must NOT fall back to the empty-message notice.
      await expect(page.getByText(/this message is empty/i)).toHaveCount(0);
    } finally {
      await owner.api.dispose();
    }
  });
});
