import { z } from 'zod';

export const KeyPair = z.object({
  publicKey: z.instanceof(Uint8Array),
  secretKey: z.instanceof(Uint8Array),
});
export type KeyPair = z.infer<typeof KeyPair>;
