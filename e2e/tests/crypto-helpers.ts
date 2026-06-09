import { blake2b } from 'blakejs';
import nacl from 'tweetnacl';

// Mirror of frontend/src/app/services/crypto.service.ts. Kept in lockstep so
// e2e payloads are byte-identical to what the browser produces — if the
// frontend changes its wrapping format, this file must change too.
//
// Wire format reminder:
//   public_key      → base64(nacl.box.publicKey)            // 32 raw bytes
//   wrapped_secret  → base64(ephemeral_pk ‖ box(secret, recipient_pk,
//                       ephemeral_sk, nonce=blake2b(ephemeral_pk ‖ recipient_pk)))
//   message         → base64(nonce ‖ secretbox(plaintext, conversation_secret))

export interface KeyPairB64 {
  publicKey: string;
  secretKey: string;
}

function toB64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString('base64');
}

function fromB64(b64: string): Uint8Array {
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

export function generateKeyPair(): KeyPairB64 {
  const kp = nacl.box.keyPair();
  return { publicKey: toB64(kp.publicKey), secretKey: toB64(kp.secretKey) };
}

// Sealed box: anonymous encryption to a recipient public key. The sender is
// a one-shot ephemeral keypair whose public half is prepended to the
// ciphertext, and the nonce is derived deterministically from both public
// keys (so the receiver can re-derive it).
export function sealFor(recipientPublicKeyB64: string, payload: Uint8Array): string {
  const recipientPub = fromB64(recipientPublicKeyB64);
  const ephemeral = nacl.box.keyPair();

  const nonceInput = new Uint8Array(ephemeral.publicKey.length + recipientPub.length);
  nonceInput.set(ephemeral.publicKey);
  nonceInput.set(recipientPub, ephemeral.publicKey.length);
  const nonce = blake2b(nonceInput, undefined, nacl.box.nonceLength);

  const ciphertext = nacl.box(payload, nonce, recipientPub, ephemeral.secretKey);

  const sealed = new Uint8Array(ephemeral.publicKey.length + ciphertext.length);
  sealed.set(ephemeral.publicKey);
  sealed.set(ciphertext, ephemeral.publicKey.length);
  return toB64(sealed);
}

export function openSealed(myKeyPair: KeyPairB64, sealedB64: string): Uint8Array {
  const sealed = fromB64(sealedB64);
  const ephemeralPub = sealed.slice(0, nacl.box.publicKeyLength);
  const ciphertext = sealed.slice(nacl.box.publicKeyLength);
  const myPub = fromB64(myKeyPair.publicKey);
  const mySec = fromB64(myKeyPair.secretKey);

  const nonceInput = new Uint8Array(ephemeralPub.length + myPub.length);
  nonceInput.set(ephemeralPub);
  nonceInput.set(myPub, ephemeralPub.length);
  const nonce = blake2b(nonceInput, undefined, nacl.box.nonceLength);

  const plain = nacl.box.open(ciphertext, nonce, ephemeralPub, mySec);
  if (plain === null) {
    throw new Error(
      'crypto-helpers: openSealed failed (wrong recipient or tampered ciphertext)',
    );
  }
  return plain;
}

// Symmetric message encryption using the conversation's secret key.
// Nonce is randomised per message and prepended to the ciphertext.
export function encryptMessage(
  conversationSecretB64: string,
  plaintext: Uint8Array,
): string {
  const key = fromB64(conversationSecretB64);
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const ciphertext = nacl.secretbox(plaintext, nonce, key);

  const full = new Uint8Array(nonce.length + ciphertext.length);
  full.set(nonce);
  full.set(ciphertext, nonce.length);
  return toB64(full);
}

export function decryptMessage(
  conversationSecretB64: string,
  ciphertextB64: string,
): Uint8Array {
  const key = fromB64(conversationSecretB64);
  const full = fromB64(ciphertextB64);
  const nonce = full.slice(0, nacl.secretbox.nonceLength);
  const ciphertext = full.slice(nacl.secretbox.nonceLength);
  const plain = nacl.secretbox.open(ciphertext, nonce, key);
  if (plain === null) {
    throw new Error(
      'crypto-helpers: decryptMessage failed (wrong key or tampered ciphertext)',
    );
  }
  return plain;
}

// Convenience: generate a fresh symmetric conversation secret key
// (32 random bytes, base64). This is the key that gets wrapped per-recipient
// via sealFor() and unwrapped via openSealed().
export function generateConversationSecret(): string {
  return toB64(nacl.randomBytes(nacl.secretbox.keyLength));
}

export const utf8 = {
  encode(s: string): Uint8Array {
    return new TextEncoder().encode(s);
  },
  decode(b: Uint8Array): string {
    return new TextDecoder().decode(b);
  },
};
