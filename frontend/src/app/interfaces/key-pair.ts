import { z } from 'zod';

export interface KeyPair {
  publicKey: Uint8Array<ArrayBufferLike>;
  secretKey: Uint8Array<ArrayBufferLike>;
}

export const KeyPair = z.object({
  publicKey: z.instanceof(Uint8Array),
  secretKey: z.instanceof(Uint8Array),
}) as z.ZodType<KeyPair>;
