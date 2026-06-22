import { blake2b } from 'blakejs';
import nacl from 'tweetnacl';

type AuthState = {
  token: string;
  model: {
    id: string;
    email: string;
    collectionId: string;
    collectionName: string;
    verified: boolean;
  };
};

export type VaultFixture = {
  authState: AuthState;
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
  userKeyPair: nacl.BoxKeyPair;
};

export type ConversationFixture = {
  conversationRecord: {
    id: string;
    created: string;
    updated: string;
    data: string;
    creator: string;
    expiry_duration?: string;
  };
  conversationPublicKeyRecord: {
    id: string;
    public_key: string;
    public_key_signature: string;
  };
  conversationSecretKeyRecord: {
    id: string;
    secret_key: string;
  };
  conversationKeyPair: nacl.BoxKeyPair;
};

export type MessageRecordFixture = {
  id: string;
  created: string;
  updated: string;
  data: string;
  conversation: string;
  parent_message?: string;
  expires?: string;
};

const textEncoder = new TextEncoder();

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

const box = (message: Uint8Array, sharedKey: Uint8Array): Uint8Array => {
  const nonce = nacl.randomBytes(nacl.box.nonceLength);
  const ciphertext = nacl.box.after(message, nonce, sharedKey);
  const fullMessage = new Uint8Array(nonce.length + ciphertext.length);
  fullMessage.set(nonce);
  fullMessage.set(ciphertext, nonce.length);
  return fullMessage;
};

const secretBox = (message: Uint8Array, key: Uint8Array): Uint8Array => {
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const ciphertext = nacl.secretbox(message, nonce, key);
  const fullMessage = new Uint8Array(nonce.length + ciphertext.length);
  fullMessage.set(nonce);
  fullMessage.set(ciphertext, nonce.length);
  return fullMessage;
};

const mac = (message: Uint8Array, key: Uint8Array, outputLength = 32): Uint8Array => {
  return blake2b(message, key, outputLength);
};

const hash = (message: Uint8Array, outputLength = 32): Uint8Array => {
  return blake2b(message, undefined, outputLength);
};

const computeRecordMAC = (
  userId: string,
  passwordSalt: string,
  publicKeyBase64: string,
  encryptedSecretKeyBase64: string,
  unlockScheme: string,
  unlockKey: Uint8Array,
): string => {
  const payload = textEncoder.encode(
    JSON.stringify([
      'user_key_pair_record_v1',
      userId,
      unlockScheme,
      passwordSalt,
      publicKeyBase64,
      encryptedSecretKeyBase64,
    ]),
  );

  return base64(mac(payload, unlockKey));
};

const conversationPublicKeySignature = (
  conversationId: string,
  conversationPublicKey: Uint8Array,
  userSecretKey: Uint8Array,
): string => {
  const payload = textEncoder.encode(
    JSON.stringify([
      'conversation_public_key_v1',
      conversationId,
      base64(conversationPublicKey),
    ]),
  );
  const macKey = mac(textEncoder.encode('cognos:conv-key-mac:v1'), userSecretKey);
  return base64(mac(payload, macKey));
};

export const buildVaultFixture = (userId: string, email: string): VaultFixture => {
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
  const publicKeyFingerprint = base64(hash(userKeyPair.publicKey));
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
    userKeyPair,
  };
};

export const buildConversationFixture = (
  userFixture: VaultFixture,
  conversationId: string,
  title: string,
): ConversationFixture => {
  const conversationKeyPair = nacl.box.keyPair();
  const sharedConversationKey = nacl.box.before(
    conversationKeyPair.publicKey,
    conversationKeyPair.secretKey,
  );
  const encryptedConversationData = box(
    textEncoder.encode(JSON.stringify({ title })),
    sharedConversationKey,
  );

  const sharedUserKey = nacl.box.before(
    conversationKeyPair.publicKey,
    userFixture.userKeyPair.secretKey,
  );
  const encryptedConversationSecretKey = box(
    conversationKeyPair.secretKey,
    sharedUserKey,
  );

  const now = new Date().toISOString();

  return {
    conversationRecord: {
      id: conversationId,
      created: now,
      updated: now,
      data: base64(encryptedConversationData),
      creator: userFixture.authState.model.id,
    },
    conversationPublicKeyRecord: {
      id: `cpk_${conversationId}`,
      public_key: base64(conversationKeyPair.publicKey),
      public_key_signature: conversationPublicKeySignature(
        conversationId,
        conversationKeyPair.publicKey,
        userFixture.userKeyPair.secretKey,
      ),
    },
    conversationSecretKeyRecord: {
      id: `csk_${conversationId}`,
      secret_key: base64(encryptedConversationSecretKey),
    },
    conversationKeyPair,
  };
};

const sealedBox = (message: Uint8Array, recipientPublicKey: Uint8Array): Uint8Array => {
  const ephemeralKeyPair = nacl.box.keyPair();
  const keys = new Uint8Array(
    ephemeralKeyPair.publicKey.length + recipientPublicKey.length,
  );
  keys.set(ephemeralKeyPair.publicKey);
  keys.set(recipientPublicKey, ephemeralKeyPair.publicKey.length);
  const nonce = blake2b(keys, undefined, nacl.secretbox.nonceLength);
  const ciphertext = nacl.box(
    message,
    nonce,
    recipientPublicKey,
    ephemeralKeyPair.secretKey,
  );

  const fullMessage = new Uint8Array(
    ephemeralKeyPair.publicKey.length + ciphertext.length,
  );
  fullMessage.set(ephemeralKeyPair.publicKey);
  fullMessage.set(ciphertext, ephemeralKeyPair.publicKey.length);
  return fullMessage;
};

export type ImageAttachmentFixture = {
  sealedKeyBase64: string;
  ciphertext: Uint8Array;
};

// buildImageAttachmentFixture encrypts raw image bytes the same way the backend
// does — a random symmetric key (secretbox), sealed to the conversation public
// key — so the app's openSealedBox + openSecretBox decrypt it on render. Used to
// drive the image-generation display path in browser e2e.
export const buildImageAttachmentFixture = (
  conversationFixture: ConversationFixture,
  imageBytes: Uint8Array,
): ImageAttachmentFixture => {
  const symmetricKey = nacl.randomBytes(nacl.secretbox.keyLength);
  const ciphertext = secretBox(imageBytes, symmetricKey);
  const sealedKey = sealedBox(
    symmetricKey,
    conversationFixture.conversationKeyPair.publicKey,
  );
  return { sealedKeyBase64: base64(sealedKey), ciphertext };
};

export const buildMessageRecordFixture = (
  conversationFixture: ConversationFixture,
  record: {
    id: string;
    created: string;
    content: string;
    ownerId?: string;
    personaId?: string;
    modelId?: string;
    parentMessageId?: string;
    expires?: string;
    attachments?: {
      kind: string;
      mime_type: string;
      sealed_key: string;
      width?: number;
      height?: number;
    }[];
  },
): MessageRecordFixture => {
  const payload = {
    content: record.content,
    conversation_id: conversationFixture.conversationRecord.id,
    ...(record.ownerId ? { owner_id: record.ownerId } : {}),
    ...(record.personaId ? { persona_id: record.personaId } : {}),
    ...(record.modelId ? { model_id: record.modelId } : {}),
    ...(record.parentMessageId ? { parent_message_id: record.parentMessageId } : {}),
    ...(record.attachments ? { attachments: record.attachments } : {}),
  };

  return {
    id: record.id,
    created: record.created,
    updated: record.created,
    data: base64(
      sealedBox(
        textEncoder.encode(JSON.stringify(payload)),
        conversationFixture.conversationKeyPair.publicKey,
      ),
    ),
    conversation: conversationFixture.conversationRecord.id,
    ...(record.parentMessageId ? { parent_message: record.parentMessageId } : {}),
    ...(record.expires ? { expires: record.expires } : {}),
  };
};

// buildPublicShareFixture produces the server-side payload + URL fragment for a
// publicly-shared conversation, mirroring what PublicShareService.share writes:
// the conversation secret sealed to a throwaway public-share public key (so the
// anonymous reader recovers it from the fragment). The fragment is the
// url-safe base64 secret half, exactly as the app puts it after `#`.
export const buildPublicShareFixture = (
  conversationFixture: ConversationFixture,
  token: string,
  // When redactionEntries are supplied the share is "include_sensitive": the
  // redaction secret is sealed to the public-share key (so the URL fragment
  // gates it, exactly like the conversation key) and the public redaction
  // entries are sealed to the redaction public key.
  options?: { redactionEntries?: RedactionEntrySeed[] },
) => {
  const publicShareKeyPair = nacl.box.keyPair();
  const wrappedConversationSecretKey = sealedBox(
    conversationFixture.conversationKeyPair.secretKey,
    publicShareKeyPair.publicKey,
  );

  const publicConversationResponse: Record<string, unknown> = {
    conversation_id: conversationFixture.conversationRecord.id,
    data: conversationFixture.conversationRecord.data,
    conversation_public_key: conversationFixture.conversationPublicKeyRecord.public_key,
    wrapped_conversation_secret_key: base64(wrappedConversationSecretKey),
    key_version: 1,
    mode: 'redacted_only',
  };

  let redactionEntriesResponse: {
    items: Array<{
      token: string;
      data: string;
      key_version: number;
      source_kind: string;
      source_id: string;
    }>;
  } = { items: [] };

  if (options?.redactionEntries?.length) {
    const redactionKeyPair = nacl.box.keyPair();
    publicConversationResponse['mode'] = 'include_sensitive';
    publicConversationResponse['wrapped_redaction_secret_key'] = base64(
      sealedBox(redactionKeyPair.secretKey, publicShareKeyPair.publicKey),
    );
    publicConversationResponse['redaction_public_key'] = base64(
      redactionKeyPair.publicKey,
    );
    redactionEntriesResponse = {
      items: options.redactionEntries.map((entry) => ({
        token: entry.token,
        data: base64(
          sealedBox(
            textEncoder.encode(
              JSON.stringify({
                version: '1',
                token: entry.token,
                type: entry.type,
                original: entry.original,
                normalized: entry.normalized,
                detector: entry.detector,
              }),
            ),
            redactionKeyPair.publicKey,
          ),
        ),
        key_version: 1,
        source_kind: 'message',
        source_id: '',
      })),
    };
  }

  return {
    token,
    fragment: Buffer.from(publicShareKeyPair.secretKey).toString('base64url'),
    publicConversationResponse,
    redactionEntriesResponse,
  };
};

export type RedactionEntrySeed = {
  token: string;
  type: string;
  original: string;
  normalized: string;
  detector: string;
};

export type RedactionFixture = {
  redactionKeyPair: nacl.BoxKeyPair;
  // Shape of GET /conversations/{id}/redaction-key.
  redactionKeyResponse: {
    public_key: string;
    wrapped_secret_key: string;
    key_version: number;
  };
  // Shape of GET /conversations/{id}/redaction-entries.
  entriesResponse: {
    items: Array<{
      token: string;
      data: string;
      key_version: number;
      source_kind: string;
      source_id: string;
    }>;
  };
};

// buildRedactionFixture mirrors what RedactionService writes: a fresh redaction
// keypair whose secret is sealed to the user's personal key (so only the user
// can open it), and one sealed entry per mapping (sealed to the redaction public
// key). The decrypted payload matches the RedactionEntry shape the client
// parses.
export const buildRedactionFixture = (
  userFixture: VaultFixture,
  entries: RedactionEntrySeed[],
): RedactionFixture => {
  const redactionKeyPair = nacl.box.keyPair();
  const wrappedSecret = sealedBox(
    redactionKeyPair.secretKey,
    userFixture.userKeyPair.publicKey,
  );

  return {
    redactionKeyPair,
    redactionKeyResponse: {
      public_key: base64(redactionKeyPair.publicKey),
      wrapped_secret_key: base64(wrappedSecret),
      key_version: 1,
    },
    entriesResponse: {
      items: entries.map((entry) => ({
        token: entry.token,
        data: base64(
          sealedBox(
            textEncoder.encode(
              JSON.stringify({
                version: '1',
                token: entry.token,
                type: entry.type,
                original: entry.original,
                normalized: entry.normalized,
                detector: entry.detector,
              }),
            ),
            redactionKeyPair.publicKey,
          ),
        ),
        key_version: 1,
        source_kind: 'message',
        source_id: '',
      })),
    },
  };
};

export type ProjectFixture = {
  projectRecord: {
    id: string;
    created: string;
    updated: string;
    data: string;
    creator: string;
    wrapped_project_key: string;
    key_version: number;
  };
  contentKey: Uint8Array;
};

// buildProjectFixture mirrors what ProjectService writes on create: the
// metadata encrypted under a random symmetric content key (secretbox), and
// that content key sealed to the user's public key so the client can recover
// it on load. Used to assert decrypt-on-load renders the project name.
export const buildProjectFixture = (
  userFixture: VaultFixture,
  projectId: string,
  name: string,
  description = '',
): ProjectFixture => {
  const contentKey = nacl.randomBytes(nacl.secretbox.keyLength);
  const encryptedData = secretBox(
    textEncoder.encode(JSON.stringify({ version: '1', name, description })),
    contentKey,
  );
  const wrappedProjectKey = sealedBox(contentKey, userFixture.userKeyPair.publicKey);
  const now = new Date().toISOString();

  return {
    projectRecord: {
      id: projectId,
      created: now,
      updated: now,
      data: base64(encryptedData),
      creator: userFixture.authState.model.id,
      wrapped_project_key: base64(wrappedProjectKey),
      key_version: 1,
    },
    contentKey,
  };
};

export type ProjectConversationFixture = {
  record: {
    id: string;
    created: string;
    updated: string;
    data: string;
    project: string;
    key_version: number;
    project_key_version: number;
    wrapped_conversation_secret_key: string;
  };
  conversationKeyPair: nacl.BoxKeyPair;
};

// buildProjectConversationFixture mirrors what ProjectConversationService
// writes: the title encrypted with the conversation keypair, and the
// conversation secret key wrapped (secretbox) by the project content key.
export const buildProjectConversationFixture = (
  projectFixture: ProjectFixture,
  conversationId: string,
  title: string,
): ProjectConversationFixture => {
  const conversationKeyPair = nacl.box.keyPair();
  const sharedKey = nacl.box.before(
    conversationKeyPair.publicKey,
    conversationKeyPair.secretKey,
  );
  const encryptedData = box(textEncoder.encode(JSON.stringify({ title })), sharedKey);
  const wrappedSecretKey = secretBox(
    conversationKeyPair.secretKey,
    projectFixture.contentKey,
  );
  const now = new Date().toISOString();

  return {
    record: {
      id: conversationId,
      created: now,
      updated: now,
      data: base64(encryptedData),
      project: projectFixture.projectRecord.id,
      key_version: 1,
      project_key_version: 1,
      wrapped_conversation_secret_key: base64(wrappedSecretKey),
    },
    conversationKeyPair,
  };
};

export const seedAuthenticatedUnlockState = async (
  page: { addInitScript: (...args: unknown[]) => Promise<void> },
  fixture: VaultFixture,
) => {
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
};
