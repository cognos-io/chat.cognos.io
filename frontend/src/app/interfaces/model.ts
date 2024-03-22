import { z } from 'zod';

export const Model = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
  description: z.string(),
  tags: z.array(z.string()).optional(),
});
export type Model = z.infer<typeof Model>;
