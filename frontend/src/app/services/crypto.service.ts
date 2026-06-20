import { Injectable } from '@angular/core';

import { blake2b } from 'blakejs';
import nacl from 'tweetnacl';

import { KeyPair } from '../interfaces/key-pair';

@Injectable({
  providedIn: 'root',
})
export class CryptoService {
  hash(message: Uint8Array, outputLength = 32): Uint8Array {
    return blake2b(message, undefined, outputLength);
  }

  mac(message: Uint8Array, key: Uint8Array, outputLength = 32): Uint8Array {
    return blake2b(message, key, outputLength);
  }

  equalBytes(left: Uint8Array, right: Uint8Array): boolean {
    if (left.length !== right.length) {
      return false;
    }

    let diff = 0;
    for (let i = 0; i < left.length; i += 1) {
      diff |= left[i] ^ right[i];
    }

    return diff === 0;
  }

  newKeyPair(): KeyPair {
    return nacl.box.keyPair();
  }

  /**
   * randomKey - generates a fresh random symmetric key suitable for secretBox
   * (e.g. a project content key). 32 bytes of CSPRNG output.
   */
  randomKey(): Uint8Array {
    return nacl.randomBytes(nacl.secretbox.keyLength);
  }

  /**
   * keyPairFromSecretKey - rebuilds the full key pair from a secret key alone.
   * Used by the public-sharing reader, which only receives the secret half in
   * the URL fragment and must recover the matching public key to open sealed
   * boxes addressed to it.
   */
  keyPairFromSecretKey(secretKey: Uint8Array): KeyPair {
    return nacl.box.keyPair.fromSecretKey(secretKey);
  }

  /**
   * sharedKey - Generates a shared key from a public key and a secret key.
   */
  sharedKey(publicKey: Uint8Array, secretKey: Uint8Array): Uint8Array {
    return nacl.box.before(publicKey, secretKey);
  }

  /**
   * box - Encrypts a message using the
   * receiver's public key and the sender's secret key.
   *
   * @param message
   * @param sharedKey
   * @returns
   */
  box(message: Uint8Array, sharedKey: Uint8Array): Uint8Array {
    const nonce = nacl.randomBytes(nacl.box.nonceLength);
    const ciphertext = nacl.box.after(message, nonce, sharedKey);

    const fullMessage = new Uint8Array(nonce.length + ciphertext.length);
    fullMessage.set(nonce);
    fullMessage.set(ciphertext, nonce.length);

    return fullMessage;
  }

  /**
   * openBox - Decrypts a message using the sender's
   * public key and the receiver's secret key.
   *
   * @param fullMessage
   * @param sharedKey
   * @returns
   */
  openBox(fullMessage: Uint8Array, sharedKey: Uint8Array): Uint8Array {
    const nonce = fullMessage.slice(0, nacl.box.nonceLength);
    const ciphertext = fullMessage.slice(nacl.box.nonceLength);
    const decrypted = nacl.box.open.after(ciphertext, nonce, sharedKey);

    if (decrypted === null) {
      throw new Error('Could not open box');
    }

    return decrypted;
  }

  /**
   * secretBox - Encrypts a message using a secret key and
   * symmetric encryption.
   *
   * @param message (Uint8Array) - The message to encrypt
   * @param key (Uint8Array) - The secret key
   * @returns (Uint8Array) - The encrypted message (ciphertext) including the nonce
   */
  secretBox(message: Uint8Array, key: Uint8Array): Uint8Array {
    const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
    const ciphertext = nacl.secretbox(message, nonce, key);

    const fullMessage = new Uint8Array(nonce.length + ciphertext.length);
    fullMessage.set(nonce);
    fullMessage.set(ciphertext, nonce.length);

    return fullMessage;
  }

  /**
   * openSecretBox - Decrypts a message using a secret key and
   * symmetric encryption.
   *
   * @param fullMessage (Uint8Array) - The encrypted message (ciphertext) including the nonce
   * @param key (Uint8Array) - The secret key (Uint8Array)
   * @returns (Uint8Array) - The decrypted message
   */
  openSecretBox(fullMessage: Uint8Array, key: Uint8Array): Uint8Array {
    const nonce = fullMessage.slice(0, nacl.secretbox.nonceLength);
    const ciphertext = fullMessage.slice(nacl.secretbox.nonceLength);
    const decrypted = nacl.secretbox.open(ciphertext, nonce, key);

    if (decrypted === null) {
      throw new Error('Could not open secret box');
    }

    return decrypted;
  }

  /**
   * openSealedBox - Decrypts a sealed box message using the receiver's key pair.
   *
   * @param sealedBox (Uint8Array) - The encrypted message (ciphertext) including the nonce and the public key (nacl.box.publicKeyLength)
   * @param myKeyPair (KeyPair) - The key pair of the receiver (publicKey and secretKey
   * @returns (Uint8Array) - The decrypted message (plaintext)
   */
  /**
   * createSealedBox - Encrypts a message to a recipient public key without a
   * persistent sender identity (anonymous sender), matching the backend's
   * AsymmetricEncrypt and the inverse of openSealedBox.
   *
   * Layout: ephemeral_pk ‖ box(m, recipient_pk, ephemeral_sk,
   * nonce=blake2b(ephemeral_pk ‖ recipient_pk)).
   *
   * @param message (Uint8Array) - The plaintext to encrypt
   * @param recipientPublicKey (Uint8Array) - The recipient's public key
   * @returns (Uint8Array) - The sealed box (ephemeral public key + ciphertext)
   */
  createSealedBox(message: Uint8Array, recipientPublicKey: Uint8Array): Uint8Array {
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
  }

  openSealedBox(sealedBox: Uint8Array, myKeyPair: KeyPair): Uint8Array {
    // Sealed boxes look like this:
    // ephemeral_pk ‖ box(m, recipient_pk, ephemeral_sk, nonce=blake2b(ephemeral_pk ‖ recipient_pk))
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
  }
}
