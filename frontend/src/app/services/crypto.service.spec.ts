import { TestBed } from '@angular/core/testing';

import { CryptoService } from './crypto.service';

describe('CryptoService', () => {
  let service: CryptoService;

  const bytes = (value: string) => Uint8Array.from(new TextEncoder().encode(value));

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
});
