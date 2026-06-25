import { z } from 'zod';

// Wire/payload types use snake_case to match the backend's encrypted JSON
// exactly (the payload is sealed by the backend, decrypted here, and parsed
// without a case transform). See docs/specs/client-side-compaction.md §6.2.

export const CompactionGlossaryEntry = z.object({
  term: z.string(),
  note: z.string(),
});
export type CompactionGlossaryEntry = z.infer<typeof CompactionGlossaryEntry>;

export const CompactionDurableMemory = z.object({
  facts: z.array(z.string()).default([]),
  decisions: z.array(z.string()).default([]),
  open_threads: z.array(z.string()).default([]),
  glossary: z.array(CompactionGlossaryEntry).default([]),
});
export type CompactionDurableMemory = z.infer<typeof CompactionDurableMemory>;

export const CompactionCitation = z.object({
  label: z.string(),
  message_id: z.string(),
});
export type CompactionCitation = z.infer<typeof CompactionCitation>;

export const CompactionPayload = z.object({
  version: z.string(),
  kind: z.literal('conversation_compaction'),
  conversation_id: z.string(),
  anchor_message_id: z.string(),
  covered_message_ids: z.array(z.string()).default([]),
  parent_compaction_id: z.string().default(''),
  compaction_level: z.number().default(0),
  durable_memory: CompactionDurableMemory,
  rolling_narrative: z.string().default(''),
  citations: z.array(CompactionCitation).default([]),
  source_token_estimate: z.number().default(0),
  summary_token_estimate: z.number().default(0),
  model_id: z.string().default(''),
  prompt_version: z.string().default(''),
  output_mode: z.string().default(''),
  created_at: z.string().default(''),
});
export type CompactionPayload = z.infer<typeof CompactionPayload>;

// Compaction is the decrypted, in-memory view the planner works with: the record
// id (for deletion / fold lineage) plus the decrypted payload.
export interface Compaction {
  recordId: string;
  conversationId: string;
  createdAt: Date;
  payload: CompactionPayload;
}
