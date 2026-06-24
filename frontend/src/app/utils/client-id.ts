// Client-generated record ids for the conversation-copy flow.
//
// The duplicate's encrypted payloads embed the final conversation and message
// ids (so parent pointers can be sealed before anything is persisted), which
// means the browser must mint ids the backend will accept verbatim. PocketBase
// `id` columns are plain text; we use a 15-character lowercase-alphanumeric
// value — the same length/alphabet as PocketBase's own default ids, so it drops
// straight in and reads consistently in the admin UI.

const ID_ALPHABET = 'abcdefghijklmnopqrstuvwxyz0123456789';
const ID_LENGTH = 15;

/**
 * clientId returns a fresh 15-char lowercase-alphanumeric id using the platform
 * CSPRNG. Rejection sampling keeps the alphabet distribution uniform (256 is not
 * a multiple of 36, so a naive modulo would bias the first few letters).
 */
export function clientId(): string {
  // 36 * 7 = 252; bytes >= 252 are discarded so every accepted byte maps to a
  // character with equal probability.
  const maxUsable = ID_ALPHABET.length * Math.floor(256 / ID_ALPHABET.length);

  let out = '';
  while (out.length < ID_LENGTH) {
    const buf = new Uint8Array(ID_LENGTH - out.length);
    crypto.getRandomValues(buf);
    for (const byte of buf) {
      if (byte >= maxUsable) {
        continue;
      }
      out += ID_ALPHABET[byte % ID_ALPHABET.length];
      if (out.length === ID_LENGTH) {
        break;
      }
    }
  }
  return out;
}

/**
 * uniqueClientIds returns `count` distinct ids. Collisions across calls to
 * clientId() are astronomically unlikely, but a single duplicate bundle must
 * never contain a repeated id, so we dedupe defensively.
 */
export function uniqueClientIds(count: number): string[] {
  const seen = new Set<string>();
  while (seen.size < count) {
    seen.add(clientId());
  }
  return [...seen];
}
