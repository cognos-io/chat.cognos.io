import { z } from 'zod';

const TagColorEnum = z.enum(['grey', 'primary']);

export const Tag = z.object({
  title: z.string(),
  color: z
    .object({
      // Color palette that defines how the tag should be displayed
      // Adding palettes here requires adding support for them in tag.component.ts
      // by adding a relevant CSS class
      palette: TagColorEnum,
      //   bg: z.string(),
      //   text: z.string(),
    })
    .optional(),
  featured: z.boolean().optional(),
});

export type Tag = z.infer<typeof Tag>;
