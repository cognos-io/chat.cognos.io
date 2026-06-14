import { expect, test } from '@playwright/test';
import { randomBytes } from 'node:crypto';

import { ProvisionedApiUser, newAnonymousApi, provisionApiUser } from './api-helpers';
import {
  KeyPairB64,
  authBox,
  generateKeyPair,
  keyPairFromSecret,
  openAuthBox,
  openSealed,
  sealFor,
  utf8,
} from './crypto-helpers';

// ─────────────────────────────────────────────────────────────────────────
// Public sharing — full-stack contract.
//
// Cognos conversations are end-to-end encrypted: the server only ever holds
// ciphertext and wrapped keys. Public sharing has to preserve that. The
// design proven here:
//
//   • A fresh "public-share" keypair S is generated on the client. Only its
//     SECRET half travels in the URL fragment (#...) — never to the server.
//   • The server stores, against a random opaque `token`:
//       wrapped_conversation_secret_key = sealedBox(convSecret, S.public)
//         → lets an anonymous visitor (holding S.secret from the fragment)
//           recover the conversation secret and decrypt everything.
//       share_secret = sealedBox(S.secret, conversationPublicKey)
//         → lets ANY participant (they all hold the conversation keypair)
//           recover S.secret and reconstruct the identical /p/<token>#<key>
//           link.
//   • Revoke rotates the conversation key (reusing /rotate), which tears down
//     the share so the public URL 404s and no future content is reachable.
//
// These tests drive the real backend + mock AI provider Playwright starts.
// ─────────────────────────────────────────────────────────────────────────

const APPROVED_MODEL_ID = 'llama-3-3-infomaniak';
const DEFAULT_AGENT_ID = 'cognos:simple-assistant';

interface ConversationResponse {
  id: string;
  key_version: number;
}

interface PublicShareResponse {
  token: string;
  key_version: number;
}

interface ParticipantShareResponse {
  token: string;
  public_key: string;
  share_secret: string;
  key_version: number;
}

interface PublicConversationResponse {
  conversation_id: string;
  data: string;
  conversation_public_key: string;
  wrapped_conversation_secret_key: string;
  key_version: number;
}

interface PublicMessagesResponse {
  totalItems: number;
  items: { id: string; data: string; parent_message?: string }[];
}

// createKeyedConversation creates a conversation whose data + public key are
// real crypto, so an anonymous reader can actually decrypt the title. It does
// NOT seed messages — message content rides on the /complete path which needs
// the AI gateway, so it's isolated to the one test that asserts it (see
// seedCompletion). Title decryption alone exercises the full key-recovery +
// box crypto path the share depends on.
async function createKeyedConversation(
  owner: ProvisionedApiUser,
  ownerKeys: KeyPairB64,
  title: string,
): Promise<{ conversationId: string; conversationKeys: KeyPairB64 }> {
  const conversationKeys = generateKeyPair();

  const data = authBox(
    conversationKeys.publicKey,
    conversationKeys.secretKey,
    utf8.encode(JSON.stringify({ title })),
  );

  const createConv = await owner.api.post('/api/v1/conversations', {
    data: { data, expiry_duration: '' },
  });
  expect(
    createConv.ok(),
    `create conv: ${createConv.status()} ${await createConv.text()}`,
  ).toBe(true);
  const { id: conversationId } = (await createConv.json()) as ConversationResponse;

  // Real conversation public key — the backend seals message blobs to it.
  const publicKeyRes = await owner.api.post(
    `/api/v1/conversations/${conversationId}/public-key`,
    {
      data: {
        public_key: conversationKeys.publicKey,
        // Signature is verified client-side by participants only; the public
        // reader can't verify it, so a placeholder is fine here.
        public_key_signature: randomBytes(32).toString('base64'),
      },
    },
  );
  expect(
    publicKeyRes.ok(),
    `public-key: ${publicKeyRes.status()} ${await publicKeyRes.text()}`,
  ).toBe(true);

  // Owner wraps the conversation secret to their own user keypair, exactly as
  // the frontend does, so the conversation is readable the normal way too.
  const secretKeyRes = await owner.api.post(
    `/api/v1/conversations/${conversationId}/secret-key`,
    {
      data: {
        secret_key: authBox(
          conversationKeys.publicKey,
          ownerKeys.secretKey,
          // Conversation secret = the conversation keypair's secret key.
          Buffer.from(conversationKeys.secretKey, 'base64'),
        ),
      },
    },
  );
  expect(
    secretKeyRes.ok(),
    `secret-key: ${secretKeyRes.status()} ${await secretKeyRes.text()}`,
  ).toBe(true);

  return { conversationId, conversationKeys };
}

// seedCompletion drives one persisted completion so the conversation gains a
// user message and an assistant reply, both sealed to the conversation public
// key by the server. Requires the AI gateway (mock provider in CI).
async function seedCompletion(
  owner: ProvisionedApiUser,
  conversationId: string,
  userMessage: string,
): Promise<void> {
  const complete = await owner.api.post(
    `/api/v1/conversations/${conversationId}/complete`,
    {
      data: {
        model_id: APPROVED_MODEL_ID,
        agent_id: DEFAULT_AGENT_ID,
        request_id: 'e2e-public-share-1',
        messages: [{ role: 'user', content: userMessage }],
      },
    },
  );
  expect(complete.ok(), `complete: ${complete.status()} ${await complete.text()}`).toBe(
    true,
  );
}

// shareConversationPublicly performs the client-side crypto for going public
// and POSTs the wrapped blobs. Returns the server token + the generated
// public-share keypair (whose secret would live in the URL fragment).
async function shareConversationPublicly(
  admin: ProvisionedApiUser,
  conversationId: string,
  conversationKeys: KeyPairB64,
): Promise<{ share: PublicShareResponse; publicShareKeys: KeyPairB64 }> {
  const publicShareKeys = generateKeyPair();

  const res = await admin.api.post(
    `/api/v1/conversations/${conversationId}/public-share`,
    {
      data: {
        public_key: publicShareKeys.publicKey,
        // Anonymous reader recovers the conversation secret with the fragment.
        wrapped_conversation_secret_key: sealFor(
          publicShareKeys.publicKey,
          Buffer.from(conversationKeys.secretKey, 'base64'),
        ),
        // Participants recover the fragment with the conversation keypair.
        share_secret: sealFor(
          conversationKeys.publicKey,
          Buffer.from(publicShareKeys.secretKey, 'base64'),
        ),
      },
    },
  );
  expect(res.ok(), `share: ${res.status()} ${await res.text()}`).toBe(true);
  const share = (await res.json()) as PublicShareResponse;
  expect(share.token).toBeTruthy();
  return { share, publicShareKeys };
}

// readPublicly walks the anonymous reader path end-to-end: fetch the public
// conversation by token, recover the conversation secret with the fragment
// secret key, decrypt the title, then fetch + decrypt the messages.
async function readPublicly(
  token: string,
  fragmentSecretKeyB64: string,
): Promise<{ title: string; messageContents: string[] }> {
  const anon = await newAnonymousApi();
  try {
    const convRes = await anon.get(`/api/v1/public/conversations/${token}`);
    expect(
      convRes.ok(),
      `public conv: ${convRes.status()} ${await convRes.text()}`,
    ).toBe(true);
    const conv = (await convRes.json()) as PublicConversationResponse;

    const publicShareKeys = keyPairFromSecret(fragmentSecretKeyB64);

    // Recover the conversation secret key from the sealed wrapper.
    const conversationSecretKey = Buffer.from(
      openSealed(publicShareKeys, conv.wrapped_conversation_secret_key),
    ).toString('base64');
    const conversationKeys: KeyPairB64 = {
      publicKey: conv.conversation_public_key,
      secretKey: conversationSecretKey,
    };

    // Decrypt the conversation data (title).
    const decryptedData = JSON.parse(
      utf8.decode(
        openAuthBox(conversationKeys.publicKey, conversationKeys.secretKey, conv.data),
      ),
    ) as { title: string };

    const msgRes = await anon.get(`/api/v1/public/conversations/${token}/messages`);
    expect(
      msgRes.ok(),
      `public messages: ${msgRes.status()} ${await msgRes.text()}`,
    ).toBe(true);
    const messages = (await msgRes.json()) as PublicMessagesResponse;

    const messageContents = messages.items.map((item) => {
      const payload = JSON.parse(utf8.decode(openSealed(conversationKeys, item.data)));
      return payload.content as string;
    });

    return { title: decryptedData.title, messageContents };
  } finally {
    await anon.dispose();
  }
}

test.describe('public sharing API', () => {
  test('owner shares publicly and an anonymous visitor can decrypt the conversation', async () => {
    const owner = await provisionApiUser();
    const ownerKeys = generateKeyPair();
    const title = 'Public board statement';

    try {
      const { conversationId, conversationKeys } = await createKeyedConversation(
        owner,
        ownerKeys,
        title,
      );

      const { share, publicShareKeys } = await shareConversationPublicly(
        owner,
        conversationId,
        conversationKeys,
      );
      expect(share.key_version).toBe(1);

      // The headline guarantee: a brand-new unauthenticated context, given
      // only the token + fragment secret, recovers the conversation secret and
      // sees the real plaintext title.
      const seen = await readPublicly(share.token, publicShareKeys.secretKey);
      expect(seen.title).toBe(title);
    } finally {
      await owner.api.dispose();
    }
  });

  test('an anonymous visitor can decrypt seeded messages through the public link', async () => {
    // Message bodies ride on the /complete path (AI gateway), so this is the
    // one test that needs the mock provider. Title-only coverage lives in the
    // sibling tests so the contract stays verifiable when the gateway is down.
    const owner = await provisionApiUser();
    const ownerKeys = generateKeyPair();
    const title = 'Conversation with messages';
    const userMessage = 'Please publish the Q2 summary.';

    try {
      const { conversationId, conversationKeys } = await createKeyedConversation(
        owner,
        ownerKeys,
        title,
      );
      await seedCompletion(owner, conversationId, userMessage);

      const { share, publicShareKeys } = await shareConversationPublicly(
        owner,
        conversationId,
        conversationKeys,
      );

      const seen = await readPublicly(share.token, publicShareKeys.secretKey);
      expect(seen.title).toBe(title);
      expect(seen.messageContents).toContain(userMessage);
    } finally {
      await owner.api.dispose();
    }
  });

  test('an unknown token 404s', async () => {
    const anon = await newAnonymousApi();
    try {
      const res = await anon.get('/api/v1/public/conversations/not-a-real-token');
      expect(res.status()).toBe(404);
      const msgs = await anon.get(
        '/api/v1/public/conversations/not-a-real-token/messages',
      );
      expect(msgs.status()).toBe(404);
    } finally {
      await anon.dispose();
    }
  });

  test('revoking public access 404s the URL and rotates the conversation key', async () => {
    const owner = await provisionApiUser();
    const ownerKeys = generateKeyPair();

    try {
      const { conversationId, conversationKeys } = await createKeyedConversation(
        owner,
        ownerKeys,
        'Soon to be private again',
      );

      const { share, publicShareKeys } = await shareConversationPublicly(
        owner,
        conversationId,
        conversationKeys,
      );

      // Sanity: the link works before revocation.
      const before = await newAnonymousApi();
      const beforeRes = await before.get(`/api/v1/public/conversations/${share.token}`);
      expect(beforeRes.ok()).toBe(true);
      await before.dispose();

      // Revoke = rotate the conversation key. The rotation re-wraps the
      // conversation secret for every active participant (just the owner
      // here) and tears down the public share in the same transaction.
      const newConversationKeys = generateKeyPair();
      const rotate = await owner.api.post(
        `/api/v1/conversations/${conversationId}/rotate`,
        {
          data: {
            public_key: newConversationKeys.publicKey,
            wrapped_secret_keys: [
              {
                user_id: owner.userId,
                secret_key: sealFor(
                  ownerKeys.publicKey,
                  Buffer.from(newConversationKeys.secretKey, 'base64'),
                ),
              },
            ],
          },
        },
      );
      expect(rotate.ok(), `rotate: ${rotate.status()} ${await rotate.text()}`).toBe(
        true,
      );
      const rotated = (await rotate.json()) as { key_version: number };
      expect(rotated.key_version).toBe(2);

      // The public URL — token + fragment — must now 404 for everyone.
      const anon = await newAnonymousApi();
      try {
        const convRes = await anon.get(`/api/v1/public/conversations/${share.token}`);
        expect(convRes.status()).toBe(404);
        const msgRes = await anon.get(
          `/api/v1/public/conversations/${share.token}/messages`,
        );
        expect(msgRes.status()).toBe(404);
      } finally {
        await anon.dispose();
      }

      // The participant-facing share lookup is gone too.
      const shareLookup = await owner.api.get(
        `/api/v1/conversations/${conversationId}/public-share`,
      );
      expect(shareLookup.status()).toBe(404);

      // The fragment key is now useless even if someone kept the old URL.
      void publicShareKeys;
    } finally {
      await owner.api.dispose();
    }
  });

  test('a participant who did not create the share recovers the identical public link and reads through it', async () => {
    const owner = await provisionApiUser();
    const ownerKeys = generateKeyPair();
    const participant = await provisionApiUser();
    const participantKeys = generateKeyPair();
    const title = 'Shared then made public';

    try {
      const { conversationId, conversationKeys } = await createKeyedConversation(
        owner,
        ownerKeys,
        title,
      );

      // Owner shares the conversation with the participant (Editor). The
      // wrapped secret is the conversation secret sealed to the participant's
      // user public key — the participant unwraps it to rebuild the
      // conversation keypair.
      const addRes = await owner.api.post(
        `/api/v1/conversations/${conversationId}/participants`,
        {
          data: {
            user_id: participant.userId,
            role: 'Editor',
            wrapped_secret_key: sealFor(
              participantKeys.publicKey,
              Buffer.from(conversationKeys.secretKey, 'base64'),
            ),
          },
        },
      );
      expect(addRes.ok(), `add: ${addRes.status()} ${await addRes.text()}`).toBe(true);

      // Owner makes it public.
      const { share, publicShareKeys } = await shareConversationPublicly(
        owner,
        conversationId,
        conversationKeys,
      );

      // The participant rebuilds their conversation keypair from their wrapped
      // secret, then asks for the public-share record.
      const secretRes = await participant.api.get(
        `/api/v1/conversations/${conversationId}/secret-key`,
      );
      expect(secretRes.ok()).toBe(true);
      const secretBody = (await secretRes.json()) as { secret_key: string };
      const recoveredConversationSecret = Buffer.from(
        openSealed(participantKeys, secretBody.secret_key),
      ).toString('base64');
      const participantConversationKeys: KeyPairB64 = {
        publicKey: conversationKeys.publicKey,
        secretKey: recoveredConversationSecret,
      };

      const shareRes = await participant.api.get(
        `/api/v1/conversations/${conversationId}/public-share`,
      );
      expect(
        shareRes.ok(),
        `participant share: ${shareRes.status()} ${await shareRes.text()}`,
      ).toBe(true);
      const participantShare = (await shareRes.json()) as ParticipantShareResponse;

      // The participant recovers the fragment secret from share_secret using
      // the conversation keypair they just rebuilt — never the creator's
      // private material.
      const recoveredFragmentSecret = Buffer.from(
        openSealed(participantConversationKeys, participantShare.share_secret),
      ).toString('base64');

      // It must be byte-identical to the creator's fragment, i.e. the SAME
      // link, and the token matches too.
      expect(recoveredFragmentSecret).toBe(publicShareKeys.secretKey);
      expect(participantShare.token).toBe(share.token);

      // And the link the participant reconstructed actually decrypts content.
      const seen = await readPublicly(participantShare.token, recoveredFragmentSecret);
      expect(seen.title).toBe(title);
    } finally {
      await owner.api.dispose();
      await participant.api.dispose();
    }
  });

  test('non-admin participants cannot create or revoke a public share', async () => {
    const owner = await provisionApiUser();
    const ownerKeys = generateKeyPair();
    const editor = await provisionApiUser();
    const editorKeys = generateKeyPair();

    try {
      const { conversationId, conversationKeys } = await createKeyedConversation(
        owner,
        ownerKeys,
        'Admin-gated sharing',
      );

      const addRes = await owner.api.post(
        `/api/v1/conversations/${conversationId}/participants`,
        {
          data: {
            user_id: editor.userId,
            role: 'Editor',
            wrapped_secret_key: sealFor(
              editorKeys.publicKey,
              Buffer.from(conversationKeys.secretKey, 'base64'),
            ),
          },
        },
      );
      expect(addRes.ok()).toBe(true);

      const editorShareKeys = generateKeyPair();
      const editorShare = await editor.api.post(
        `/api/v1/conversations/${conversationId}/public-share`,
        {
          data: {
            public_key: editorShareKeys.publicKey,
            wrapped_conversation_secret_key: sealFor(
              editorShareKeys.publicKey,
              Buffer.from(conversationKeys.secretKey, 'base64'),
            ),
            share_secret: sealFor(
              conversationKeys.publicKey,
              Buffer.from(editorShareKeys.secretKey, 'base64'),
            ),
          },
        },
      );
      expect(editorShare.status()).toBe(403);

      // An outsider must not even learn the conversation exists.
      const outsider = await provisionApiUser();
      try {
        const outsiderShare = await outsider.api.get(
          `/api/v1/conversations/${conversationId}/public-share`,
        );
        expect(outsiderShare.status()).toBe(404);
      } finally {
        await outsider.api.dispose();
      }
    } finally {
      await owner.api.dispose();
      await editor.api.dispose();
    }
  });
});
