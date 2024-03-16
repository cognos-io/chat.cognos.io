import { Injectable } from '@angular/core';

import nacl from 'tweetnacl';

import { KeyPair } from '../interfaces/key-pair';

@Injectable({
  providedIn: 'root',
})
export class CryptoService {
  newKeyPair(): KeyPair {
    return nacl.box.keyPair();
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
      throw new Error('Could not decrypt message');
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
      throw new Error('Could not decrypt message');
    }

    return decrypted;
  }
}
