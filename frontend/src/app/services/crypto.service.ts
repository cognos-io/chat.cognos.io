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
   * @param cipherText
   * @param sharedKey
   * @returns
   */
  openBox(cipherText: Uint8Array, sharedKey: Uint8Array): Uint8Array {
    const nonce = cipherText.slice(0, nacl.box.nonceLength);
    const ciphertext = cipherText.slice(nacl.box.nonceLength);
    const decrypted = nacl.box.open.after(ciphertext, nonce, sharedKey);

    if (decrypted === null) {
      throw new Error('Could not decrypt message');
    }

    return decrypted;
  }
}
