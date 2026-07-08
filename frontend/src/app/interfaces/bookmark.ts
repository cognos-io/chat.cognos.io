import { z } from 'zod';

/**
 * A bookmark's sealed payload. The highlighted text and its surrounding context
 * are chat content, so the whole payload is sealed CLIENT-SIDE to the user's
 * vault public key and stored as opaque ciphertext (the server only ever sees
 * base64). The anchor is a text-quote-with-context selector (see
 * bookmark-highlight/bookmark-anchor.ts) — robust to markdown re-rendering,
 * unlike numeric offsets.
 */
export const BookmarkPayload = z.object({
  version: z.literal('1'),
  kind: z.literal('bookmark'),
  quote: z.string(),
  prefix: z.string(),
  suffix: z.string(),
  note: z.string().optional(),
  created_at: z.string(),
});
export type BookmarkPayload = z.infer<typeof BookmarkPayload>;

/** A decrypted bookmark held in memory. */
export interface Bookmark {
  recordId: string;
  conversationId: string;
  messageId: string;
  quote: string;
  prefix: string;
  suffix: string;
  note?: string;
  createdAt: string;
}
