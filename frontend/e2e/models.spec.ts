import { expect, test } from '@playwright/test';
import { blake2b } from 'blakejs';
import nacl from 'tweetnacl';

type VaultFixture = {
  authState: {
    token: string;
    model: {
      id: string;
      email: string;
      collectionId: string;
      collectionName: string;
      verified: boolean;
    };
  };
  trustedUnlockBlob: {
    nonce: string;
    ciphertext: string;
  };
  trustedUserContext: {
    passwordSalt: string;
    publicKeyFingerprint: string;
    unlockScheme: string;
  };
  userKeyPairRecord: {
    id: string;
    collectionId: string;
    collectionName: string;
    created: string;
    updated: string;
    user: string;
    password_salt: string;
    public_key: string;
    record_mac: string;
    secret_key: string;
    unlock_scheme: string;
  };
  vaultSession: {
    wrap_key: string;
  };
};

const base64 = (bytes: Uint8Array): string => Buffer.from(bytes).toString('base64');

const buildToken = (userId: string): string => {
  const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString(
    'base64url',
  );
  const payload = Buffer.from(
    JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 60 * 60, sub: userId }),
  ).toString('base64url');

  return `${header}.${payload}.sig`;
};

const secretBox = (message: Uint8Array, key: Uint8Array): Uint8Array => {
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const ciphertext = nacl.secretbox(message, nonce, key);
  const fullMessage = new Uint8Array(nonce.length + ciphertext.length);
  fullMessage.set(nonce);
  fullMessage.set(ciphertext, nonce.length);
  return fullMessage;
};

const computeRecordMAC = (
  userId: string,
  passwordSalt: string,
  publicKeyBase64: string,
  encryptedSecretKeyBase64: string,
  unlockScheme: string,
  unlockKey: Uint8Array,
): string => {
  const payload = new TextEncoder().encode(
    JSON.stringify([
      'user_key_pair_record_v1',
      userId,
      unlockScheme,
      passwordSalt,
      publicKeyBase64,
      encryptedSecretKeyBase64,
    ]),
  );

  return base64(blake2b(payload, unlockKey, 32));
};

const buildVaultFixture = (userId: string, email: string): VaultFixture => {
  const unlockScheme = 'password_account_key_v1';
  const passwordSalt = base64(nacl.randomBytes(16));
  const userKeyPair = nacl.box.keyPair();
  const unlockKey = nacl.randomBytes(nacl.secretbox.keyLength);
  const encryptedSecretKey = secretBox(userKeyPair.secretKey, unlockKey);
  const publicKeyBase64 = base64(userKeyPair.publicKey);
  const encryptedSecretKeyBase64 = base64(encryptedSecretKey);
  const recordMAC = computeRecordMAC(
    userId,
    passwordSalt,
    publicKeyBase64,
    encryptedSecretKeyBase64,
    unlockScheme,
    unlockKey,
  );

  const wrapKey = nacl.randomBytes(nacl.secretbox.keyLength);
  const wrapNonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const trustedUnlockCiphertext = nacl.secretbox(unlockKey, wrapNonce, wrapKey);
  const publicKeyFingerprint = base64(blake2b(userKeyPair.publicKey, undefined, 32));
  const now = new Date().toISOString();

  return {
    authState: {
      token: buildToken(userId),
      model: {
        id: userId,
        email,
        collectionId: '_pb_users_auth_',
        collectionName: 'users',
        verified: true,
      },
    },
    trustedUnlockBlob: {
      nonce: base64(wrapNonce),
      ciphertext: base64(trustedUnlockCiphertext),
    },
    trustedUserContext: {
      passwordSalt,
      publicKeyFingerprint,
      unlockScheme,
    },
    userKeyPairRecord: {
      id: 'ukp_e2e',
      collectionId: 'user_key_pairs',
      collectionName: 'user_key_pairs',
      created: now,
      updated: now,
      user: userId,
      password_salt: passwordSalt,
      public_key: publicKeyBase64,
      record_mac: recordMAC,
      secret_key: encryptedSecretKeyBase64,
      unlock_scheme: unlockScheme,
    },
    vaultSession: {
      wrap_key: base64(wrapKey),
    },
  };
};

test('authenticated user loads models from the backend catalogue', async ({ page }) => {
  const fixture = buildVaultFixture('user_e2e', 'e2e@example.com');

  await page.addInitScript(({ authState, trustedUnlockBlob, trustedUserContext }) => {
    localStorage.setItem('pocketbase_auth', JSON.stringify(authState));
    localStorage.setItem(
      `cognos:vault-session:${authState.model.id}`,
      JSON.stringify(trustedUnlockBlob),
    );
    localStorage.setItem(
      `cognos:trusted-user-key:${authState.model.id}`,
      JSON.stringify(trustedUserContext),
    );
  }, fixture);

  await page.route('http://localhost:8090/api/v1/user-key-pair', async (route) => {
    await route.fulfill({ json: fixture.userKeyPairRecord });
  });

  await page.route('http://localhost:8090/api/v1/vault-session', async (route) => {
    await route.fulfill({ json: fixture.vaultSession });
  });

  await page.route('http://localhost:8090/api/v1/conversations', async (route) => {
    await route.fulfill({ json: [] });
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
            id: 'global-model',
            name: 'Global Model',
            slug: 'global-model',
            provider_id: 'global-provider',
            provider_model_id: 'global-model',
            description: 'Unavailable for this user',
            privacy_tier: 'global',
            tags: [{ title: 'general-purpose' }],
            content_types: ['text'],
            input_context_tokens: 32000,
            pricing: {
              input_usd_per_million_tokens: 1,
              output_usd_per_million_tokens: 2,
            },
            is_eligible: false,
            ineligibility_reason: 'model privacy tier exceeds user privacy tier',
          },
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

  await page.goto('/');

  await expect(page).toHaveURL(/\/$/);

  const modelTrigger = page.getByRole('button', { name: 'EU Model' });
  await expect(modelTrigger).toBeVisible();

  await modelTrigger.click();

  await expect(page.getByRole('listbox', { name: 'Pick your AI model' })).toBeVisible();
  await expect(page.getByRole('option', { name: /EU Model/ })).toBeEnabled();
  await expect(
    page.getByRole('option', { name: /Global Model.*Needs Global processing/ }),
  ).toBeDisabled();
});
