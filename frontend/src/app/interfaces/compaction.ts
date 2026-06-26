import { z } from 'zod';

// Wire/payload types use snake_case to match the backend's encrypted JSON
// exactly (the payload is sealed by the backend, decrypted here, and parsed
// without a case transform). See docs/specs/client-side-compaction.md §6.2.

// Durable memory is a single flat list of memory items (stable facts,
// decisions, open questions, important names/placeholders) rather than separate
// buckets, so the user-facing memory reads as a simple bullet list (spec §8.2).
export const CompactionDurableMemory = z.object({
  items: z.array(z.string()).default([]),
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

// MemoryScope identifies which store a pinned snippet belongs to.
export type MemoryScope = 'conversation' | 'user' | 'project';

// ScopedMemoryPayload is the decrypted shape of a user- or project-scoped memory
// record. It reuses the durable-memory structure but is not tied to any
// conversation/message prefix (spec §16). Sealed to the user's public key (user
// scope) or the project content key (project scope).
export const ScopedMemoryPayload = z.object({
  version: z.string().default('1'),
  kind: z.literal('scoped_memory'),
  scope: z.enum(['user', 'project']),
  durable_memory: CompactionDurableMemory,
  created_at: z.string().default(''),
});
export type ScopedMemoryPayload = z.infer<typeof ScopedMemoryPayload>;

// ScopedMemory is the decrypted, cached view of a user/project memory record.
export interface ScopedMemory {
  recordId: string;
  payload: ScopedMemoryPayload;
}
