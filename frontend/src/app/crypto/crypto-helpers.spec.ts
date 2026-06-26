import nacl from 'tweetnacl';

import { hashBytes } from './hash';
import { createSealedBox, openSealedBox } from './sealed-box';
import { openSecretBox, randomSecretKey, secretBox } from './secret-box';

const bytes = (value: string): Uint8Array =>
  Uint8Array.from(new TextEncoder().encode(value));
const text = (value: Uint8Array): string => new TextDecoder().decode(value);

describe('crypto helpers (worker-shared)', () => {
  describe('secretBox', () => {
    it('round-trips a message under a random key', () => {
      const key = randomSecretKey();
      const message = bytes('attachment ciphertext payload');

      const box = secretBox(message, key);
      expect(box).not.toEqual(message);
      expect(text(openSecretBox(box, key))).toBe('attachment ciphertext payload');
    });

    it('throws when authentication fails (wrong key)', () => {
      const box = secretBox(bytes('secret'), randomSecretKey());
      expect(() => openSecretBox(box, randomSecretKey())).toThrow();
    });

    it('produces a 32-byte key', () => {
      expect(randomSecretKey().length).toBe(32);
    });
  });

  describe('sealed box', () => {
    it('round-trips to a recipient key pair', () => {
      const recipient = nacl.box.keyPair();
      const sealed = createSealedBox(bytes('manifest json'), recipient.publicKey);

      expect(text(openSealedBox(sealed, recipient))).toBe('manifest json');
    });

    it('cannot be opened by a different key pair', () => {
      const recipient = nacl.box.keyPair();
      const stranger = nacl.box.keyPair();
      const sealed = createSealedBox(bytes('manifest json'), recipient.publicKey);

      expect(() => openSealedBox(sealed, stranger)).toThrow();
    });
  });

  describe('hashBytes', () => {
    it('is deterministic and 32 bytes by default', () => {
      const a = hashBytes(bytes('hello'));
      const b = hashBytes(bytes('hello'));
      expect(a.length).toBe(32);
      expect(a).toEqual(b);
    });

    it('differs for different input', () => {
      expect(hashBytes(bytes('a'))).not.toEqual(hashBytes(bytes('b')));
    });
  });
});
