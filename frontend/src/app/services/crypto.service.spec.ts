import { TestBed } from '@angular/core/testing';

import { blake2b } from 'blakejs';
import nacl from 'tweetnacl';

import { CryptoService } from './crypto.service';

describe('CryptoService', () => {
  let service: CryptoService;

  const bytes = (value: string) => Uint8Array.from(new TextEncoder().encode(value));

  // Build a libsodium-compatible sealed box payload for testing openSealedBox.
  // Mirrors the libsodium crypto_box_seal layout the receiver expects.
  const sealBox = (
    message: Uint8Array,
    recipientPublicKey: Uint8Array,
    ephemeralKeyPair: nacl.BoxKeyPair = nacl.box.keyPair(),
  ): Uint8Array => {
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

    const sealed = new Uint8Array(
      ephemeralKeyPair.publicKey.length + ciphertext.length,
    );
    sealed.set(ephemeralKeyPair.publicKey);
    sealed.set(ciphertext, ephemeralKeyPair.publicKey.length);
    return sealed;
  };

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [CryptoService],
    });

    service = TestBed.inject(CryptoService);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('compares byte arrays in constant time', () => {
    expect(
      service.equalBytes(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3])),
    ).toBe(true);
    expect(
      service.equalBytes(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4])),
    ).toBe(false);
    expect(service.equalBytes(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]))).toBe(
      false,
    );
  });

  it('round-trips box encryption with a shared key', () => {
    const alice = service.newKeyPair();
    const bob = service.newKeyPair();
    const sharedKey = new Uint8Array(service.sharedKey(bob.publicKey, alice.secretKey));
    const plaintext = bytes('encrypted conversation payload');

    const ciphertext = service.box(plaintext, sharedKey);
    const decrypted = service.openBox(ciphertext, sharedKey);

    expect(Array.from(decrypted)).toEqual(Array.from(plaintext));
  });

  it('round-trips secretBox encryption with a symmetric key', () => {
    const key = new Uint8Array(service.hash(bytes('vault unlock key material')));
    const plaintext = bytes('secret key bytes');

    const ciphertext = service.secretBox(plaintext, key);
    const decrypted = service.openSecretBox(ciphertext, key);

    expect(Array.from(decrypted)).toEqual(Array.from(plaintext));
  });

  it('produces deterministic hash and mac output for the same inputs', () => {
    const message = bytes('integrity payload');
    const key = bytes('mac-key');

    expect(Array.from(service.hash(message))).toEqual(
      Array.from(service.hash(message)),
    );
    expect(Array.from(service.mac(message, key))).toEqual(
      Array.from(service.mac(message, key)),
    );
  });

  it('rejects tampered box ciphertext', () => {
    const alice = service.newKeyPair();
    const bob = service.newKeyPair();
    const sharedKey = new Uint8Array(service.sharedKey(bob.publicKey, alice.secretKey));
    const ciphertext = service.box(bytes('payload'), sharedKey);
    ciphertext[ciphertext.length - 1] ^= 0xff;

    expect(() => service.openBox(ciphertext, sharedKey)).toThrow('Could not open box');
  });

  it('rejects secretBox ciphertext opened with the wrong key', () => {
    const key = new Uint8Array(service.hash(bytes('correct key')));
    const wrongKey = new Uint8Array(service.hash(bytes('wrong key')));
    const ciphertext = service.secretBox(bytes('payload'), key);

    expect(() => service.openSecretBox(ciphertext, wrongKey)).toThrow(
      'Could not open secret box',
    );
  });

  it('opens a libsodium-shape sealed box for its intended recipient', () => {
    const recipient = service.newKeyPair();
    const plaintext = bytes('conversation secret key bytes');
    const sealed = sealBox(plaintext, recipient.publicKey);

    const decrypted = service.openSealedBox(sealed, recipient);

    expect(Array.from(decrypted)).toEqual(Array.from(plaintext));
  });

  it('round-trips a sealed box created with createSealedBox', () => {
    const recipient = service.newKeyPair();
    const plaintext = bytes('a message tombstone payload');

    const sealed = service.createSealedBox(plaintext, recipient.publicKey);
    const decrypted = service.openSealedBox(sealed, recipient);

    expect(Array.from(decrypted)).toEqual(Array.from(plaintext));
  });

  it('createSealedBox output cannot be opened by a different recipient', () => {
    const recipient = service.newKeyPair();
    const attacker = service.newKeyPair();

    const sealed = service.createSealedBox(bytes('secret'), recipient.publicKey);

    expect(() => service.openSealedBox(sealed, attacker)).toThrow();
  });

  it('rejects a sealed box opened with the wrong recipient key pair', () => {
    const recipient = service.newKeyPair();
    const wrongRecipient = service.newKeyPair();
    const sealed = sealBox(bytes('payload'), recipient.publicKey);

    expect(() => service.openSealedBox(sealed, wrongRecipient)).toThrow(
      'Could not open sealed box',
    );
  });

  it('rejects a sealed box with tampered ciphertext bytes', () => {
    const recipient = service.newKeyPair();
    const sealed = sealBox(bytes('payload'), recipient.publicKey);
    sealed[sealed.length - 1] ^= 0xff;

    expect(() => service.openSealedBox(sealed, recipient)).toThrow(
      'Could not open sealed box',
    );
  });

  it('rejects a sealed box whose ephemeral public key has been swapped', () => {
    const recipient = service.newKeyPair();
    const sealed = sealBox(bytes('payload'), recipient.publicKey);
    // Replace the first 32 bytes (ephemeral pk) with another valid public key.
    // The MAC and nonce derivation will diverge so opening must fail.
    const otherEphemeral = service.newKeyPair().publicKey;
    sealed.set(otherEphemeral, 0);

    expect(() => service.openSealedBox(sealed, recipient)).toThrow(
      'Could not open sealed box',
    );
  });

  it('produces different mac output for different keys', () => {
    const message = bytes('payload');
    const keyA = bytes('mac-key-a');
    const keyB = bytes('mac-key-b');

    const macA = Array.from(service.mac(message, keyA));
    const macB = Array.from(service.mac(message, keyB));
    expect(macA).not.toEqual(macB);
  });

  it('respects the optional output length for hash and mac', () => {
    const message = bytes('payload');
    const key = bytes('mac-key');

    expect(service.hash(message, 16).length).toBe(16);
    expect(service.hash(message, 64).length).toBe(64);
    expect(service.mac(message, key, 16).length).toBe(16);
  });
});
