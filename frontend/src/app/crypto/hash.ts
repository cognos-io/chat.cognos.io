import { blake2b } from 'blakejs';

/**
 * Framework-free crypto helpers shared by {@link CryptoService} and the
 * attachment Web Worker (which cannot use Angular DI). Behaviour is pinned by
 * CryptoService's existing tests, which delegate here.
 */

/**
 * hashBytes - blake2b digest of a message. Used for the attachment manifest's
 * end-to-end integrity hash (blake2b-256 of each artifact's plaintext).
 */
export const hashBytes = (message: Uint8Array, outputLength = 32): Uint8Array =>
  blake2b(message, undefined, outputLength);
