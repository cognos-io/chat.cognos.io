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
   * box - Encrypts a message using the
   * receiver's public key and the sender's secret key.
   *
   * @param message
   * @param receiverPublicKey
   * @param senderKeyPair
   * @returns
   */
  box(
    message: Uint8Array,
    receiverPublicKey: Uint8Array,
    senderKeyPair: KeyPair
  ): Uint8Array {
    const nonce = nacl.randomBytes(nacl.box.nonceLength);
    const ciphertext = nacl.box(
      message,
      nonce,
      receiverPublicKey,
      senderKeyPair.secretKey
    );

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
   * @param senderPublicKey
   * @param receiverKeyPair
   * @returns
   */
  openBox(
    cipherText: Uint8Array,
    senderPublicKey: Uint8Array,
    receiverKeyPair: KeyPair
  ): Uint8Array {
    const nonce = cipherText.slice(0, nacl.box.nonceLength);
    const ciphertext = cipherText.slice(nacl.box.nonceLength);
    const decrypted = nacl.box.open(
      ciphertext,
      nonce,
      senderPublicKey,
      receiverKeyPair.secretKey
    );

    if (decrypted === null) {
      throw new Error('Could not decrypt message');
    }

    return decrypted;
  }
}
