import { z } from 'zod';

export const Agent = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string(),
  tags: z.array(z.string()).optional(),
});
export type Agent = z.infer<typeof Agent>;
