import { Injectable } from '@angular/core';
import nacl from 'tweetnacl';
import { KeyPair } from '../interfaces/key-pair';
import { blake2b } from 'blakejs';

@Injectable({
  providedIn: 'root',
})
export class CryptoService {
  newKeyPair(): KeyPair {
    return nacl.box.keyPair();
  }

  box(
    message: string,
    receiverPublicKey: Uint8Array,
    senderKeyPair: KeyPair
  ): Uint8Array {
    const nonce = nacl.randomBytes(nacl.box.nonceLength);
    const ciphertext = nacl.box(
      new TextEncoder().encode(message),
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
   * Implementation of a libsodium sealed box that generates an ephemeral key pair
   * and uses it to encrypt a message for a recipient.
   *
   * The format of a sealed box is:
   * ephemeral_pk ‖ box(m, recipient_pk, ephemeral_sk, nonce=blake2b(ephemeral_pk ‖ recipient_pk))
   *
   * @param message (string) the plaintext message to encrypt
   * @param receiverPublicKey (Uint8Array) the public key of the recipient
   * @returns (Uint8Array) the full message (ephemeralKeyPair.publicKey ‖ ciphertext)
   */
  sealedBox(message: string, receiverPublicKey: Uint8Array): Uint8Array {
    const ephemeralKeyPair = this.newKeyPair();

    try {
      const nonce = sealedBoxNonce(
        ephemeralKeyPair.publicKey,
        receiverPublicKey
      );

      const ciphertext = nacl.box(
        new TextEncoder().encode(message),
        nonce,
        receiverPublicKey,
        ephemeralKeyPair.secretKey
      );

      const fullMessage = new Uint8Array(
        ephemeralKeyPair.publicKey.length + ciphertext.length
      );
      fullMessage.set(ephemeralKeyPair.publicKey);
      fullMessage.set(ciphertext, ephemeralKeyPair.publicKey.length);

      return fullMessage;
    } finally {
      ephemeralKeyPair.secretKey.fill(0);
    }
  }
}

const sealedBoxNonce = (
  ephemeralPublicKey: Uint8Array,
  receiverPublicKey: Uint8Array
): Uint8Array => {
  const combined = new Uint8Array(
    ephemeralPublicKey.length + receiverPublicKey.length
  );
  combined.set(ephemeralPublicKey);
  combined.set(receiverPublicKey, ephemeralPublicKey.length);
  return blake2b(combined, undefined, nacl.box.nonceLength);
};
