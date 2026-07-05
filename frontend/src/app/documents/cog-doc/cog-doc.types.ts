// Types for the `<cog-doc>` document source contract (spec
// docs/specs/document-generation.md §6). No Angular imports — this module is
// parsed on every streamed delta and must stay framework-free and pure.
import { z } from 'zod';

// Spec §6.4: source block (tags included) must fit the existing 1 MB
// `messages.data` column with sealing overhead and the rest of the reply.
export const COG_DOC_MAX_SOURCE_BYTES = 256 * 1024;

/**
 * cogDocSpecSchema validates the `spec='{…}'` JSON attribute (spec §6.1).
 * `.strip()` drops unknown keys instead of rejecting them — forward
 * compatibility with specs from newer prompt versions. `v` tolerates being
 * missing entirely (older/careless model output still parses).
 */
export const cogDocSpecSchema = z
  .object({
    v: z.literal(1).optional(),
    format: z.enum(['docx', 'pdf']), // 'xlsx' joins in Phase 3 (§5.3)
    title: z.string().max(300).optional(),
    filename: z.string().max(200).optional(),
    lang: z.string().max(35).optional(),
    page: z
      .object({
        size: z.literal('A4').optional(),
        orientation: z.enum(['portrait', 'landscape']).optional(),
      })
      .optional(),
    header: z.string().max(300).optional(),
    footer: z.object({ pageNumbers: z.boolean().optional() }).optional(),
  })
  .strip();
export type CogDocSpec = z.infer<typeof cogDocSpecSchema>;

export type CogDocBlockState = 'streaming' | 'ready' | 'invalid';

/**
 * CogDocBlock is one parsed `<cog-doc>…</cog-doc>` region. `spec` is `null`
 * when the `spec` attribute failed to parse or validate (→ 'invalid' once
 * the block closes); `raw` is always the full block text including tags —
 * what fail-open display shows verbatim (spec §5.2, §6.2).
 */
export interface CogDocBlock {
  state: CogDocBlockState;
  spec: CogDocSpec | null;
  body: string;
  raw: string;
}

export type MessageSegment =
  | { kind: 'markdown'; text: string }
  | { kind: 'document'; block: CogDocBlock };
