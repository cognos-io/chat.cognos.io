import { blake2b } from 'blakejs';
import nacl from 'tweetnacl';

import type { KeyPair } from '../interfaces/key-pair';

/**
 * Framework-free sealed-box (anonymous-sender) helpers shared by
 * {@link CryptoService} and the attachment Web Worker. Matches the backend's
 * AsymmetricEncrypt / NaCl sealed-box layout:
 *
 *   ephemeral_pk || box(m, recipient_pk, ephemeral_sk,
 *                       nonce = blake2b(ephemeral_pk || recipient_pk))
 */

/**
 * createSealedBox - encrypts a message to a recipient public key without a
 * persistent sender identity. Used to seal the attachment manifest to the
 * conversation public key.
 */
export const createSealedBox = (
  message: Uint8Array,
  recipientPublicKey: Uint8Array,
): Uint8Array => {
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

  const sealedBox = new Uint8Array(
    ephemeralKeyPair.publicKey.length + ciphertext.length,
  );
  sealedBox.set(ephemeralKeyPair.publicKey);
  sealedBox.set(ciphertext, ephemeralKeyPair.publicKey.length);

  return sealedBox;
};

/**
 * openSealedBox - inverse of {@link createSealedBox}. Throws if the box cannot
 * be opened with the given key pair.
 */
export const openSealedBox = (
  sealedBox: Uint8Array,
  myKeyPair: KeyPair,
): Uint8Array => {
  const theirPublicKey = sealedBox.slice(0, nacl.box.publicKeyLength);
  const ciphertext = sealedBox.slice(nacl.box.publicKeyLength);

  const keys = new Uint8Array(theirPublicKey.length + myKeyPair.publicKey.length);
  keys.set(theirPublicKey);
  keys.set(myKeyPair.publicKey, theirPublicKey.length);

  const nonce = blake2b(keys, undefined, nacl.secretbox.nonceLength);

  const decryptedMessage = nacl.box.open(
    ciphertext,
    nonce,
    theirPublicKey,
    myKeyPair.secretKey,
  );
  if (decryptedMessage === null) {
    throw new Error('Could not open sealed box');
  }

  return decryptedMessage;
};
