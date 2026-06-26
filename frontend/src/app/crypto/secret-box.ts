import nacl from 'tweetnacl';

/**
 * Framework-free secretbox helpers shared by {@link CryptoService} and the
 * attachment Web Worker. Layout is `nonce || ciphertext`, matching the backend
 * (crypto.SymmetricEncrypt) and the existing message/attachment scheme.
 */

/**
 * randomSecretKey - 32 bytes of CSPRNG output, suitable for {@link secretBox}
 * (e.g. a per-artifact attachment key).
 */
export const randomSecretKey = (): Uint8Array =>
  nacl.randomBytes(nacl.secretbox.keyLength);

/**
 * secretBox - symmetric authenticated encryption. Returns `nonce || ciphertext`.
 */
export const secretBox = (message: Uint8Array, key: Uint8Array): Uint8Array => {
  const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
  const ciphertext = nacl.secretbox(message, nonce, key);

  const fullMessage = new Uint8Array(nonce.length + ciphertext.length);
  fullMessage.set(nonce);
  fullMessage.set(ciphertext, nonce.length);

  return fullMessage;
};

/**
 * openSecretBox - inverse of {@link secretBox}. Throws if authentication fails.
 */
export const openSecretBox = (fullMessage: Uint8Array, key: Uint8Array): Uint8Array => {
  const nonce = fullMessage.slice(0, nacl.secretbox.nonceLength);
  const ciphertext = fullMessage.slice(nacl.secretbox.nonceLength);
  const decrypted = nacl.secretbox.open(ciphertext, nonce, key);

  if (decrypted === null) {
    throw new Error('Could not open secret box');
  }

  return decrypted;
};
