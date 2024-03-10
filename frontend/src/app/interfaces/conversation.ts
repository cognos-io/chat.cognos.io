import { z } from 'zod';
import { Base64 } from 'js-base64';

export const Conversation = z.object({
  id: z.string(),
  created: z.string().datetime(),
  updated: z.string().datetime(),
  data: z.string().refine(Base64.isValid), // base64 encrypted data
  creatorId: z.string().optional(), // may be null for some reason
});
export type Conversation = z.infer<typeof Conversation>;
