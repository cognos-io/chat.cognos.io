import { expect, test } from '@playwright/test';

import {
  decryptMessage,
  encryptMessage,
  generateConversationSecret,
  generateKeyPair,
  openSealed,
  sealFor,
  utf8,
} from './crypto-helpers';

test.describe('crypto-helpers', () => {
  test('sealFor → openSealed round-trips the original bytes', () => {
    const alice = generateKeyPair();
    const conversationSecret = generateConversationSecret();
    const sealed = sealFor(alice.publicKey, utf8.encode(conversationSecret));
    const opened = utf8.decode(openSealed(alice, sealed));
    expect(opened).toBe(conversationSecret);
  });

  test('openSealed throws for the wrong recipient', () => {
    const alice = generateKeyPair();
    const mallory = generateKeyPair();
    const sealed = sealFor(alice.publicKey, utf8.encode('secret-payload'));
    expect(() => openSealed(mallory, sealed)).toThrow(/openSealed failed/);
  });

  test('sealFor is non-deterministic (fresh ephemeral key per call)', () => {
    const alice = generateKeyPair();
    const payload = utf8.encode('same-payload');
    const a = sealFor(alice.publicKey, payload);
    const b = sealFor(alice.publicKey, payload);
    expect(a).not.toBe(b);
    expect(utf8.decode(openSealed(alice, a))).toBe('same-payload');
    expect(utf8.decode(openSealed(alice, b))).toBe('same-payload');
  });

  test('encryptMessage → decryptMessage round-trips the original bytes', () => {
    const secret = generateConversationSecret();
    const plaintext = 'Hello, conversation 🔐';
    const ciphertext = encryptMessage(secret, utf8.encode(plaintext));
    const recovered = utf8.decode(decryptMessage(secret, ciphertext));
    expect(recovered).toBe(plaintext);
  });

  test('decryptMessage throws for the wrong conversation secret', () => {
    const correct = generateConversationSecret();
    const wrong = generateConversationSecret();
    const ciphertext = encryptMessage(correct, utf8.encode('payload'));
    expect(() => decryptMessage(wrong, ciphertext)).toThrow(/decryptMessage failed/);
  });

  test('encryptMessage uses a fresh nonce each call', () => {
    const secret = generateConversationSecret();
    const payload = utf8.encode('same-plaintext');
    const a = encryptMessage(secret, payload);
    const b = encryptMessage(secret, payload);
    expect(a).not.toBe(b);
  });

  test('generateKeyPair produces base64 public keys of the expected length', () => {
    const kp = generateKeyPair();
    // Curve25519 public keys are 32 bytes → 44-char base64 with one '=' pad.
    expect(Buffer.from(kp.publicKey, 'base64').length).toBe(32);
    expect(Buffer.from(kp.secretKey, 'base64').length).toBe(32);
  });

  test('generateConversationSecret produces a 32-byte symmetric key', () => {
    const secret = generateConversationSecret();
    expect(Buffer.from(secret, 'base64').length).toBe(32);
  });
});
