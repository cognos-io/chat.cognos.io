import { Injectable, inject, signal } from '@angular/core';

import { Observable, forkJoin, map, of } from 'rxjs';

import { Base64 } from 'js-base64';

import {
  Compaction,
  CompactionPayload,
  ScopedMemory,
} from '@app/interfaces/compaction';
import { KeyPair } from '@app/interfaces/key-pair';

import {
  ApiCompactionRecord,
  ApiCreateCompactionRequest,
  ApiCreateCompactionResponse,
  CognosApiService,
} from './cognos-api.service';
import { CryptoService } from './crypto.service';

// isCompactionValidForBranch reports whether a compaction's covered messages
// form a contiguous prefix of the active branch ending exactly at its anchor
// (spec §9.1). Validity is about applicability to THIS branch — not which branch
// created it — so a prefix compaction is reused across siblings that share
// history.
export const isCompactionValidForBranch = (
  payload: CompactionPayload,
  branchMessageIds: readonly string[],
): boolean => {
  const covered = payload.covered_message_ids;
  if (covered.length === 0 || covered.length > branchMessageIds.length) {
    return false;
  }
  for (let i = 0; i < covered.length; i++) {
    if (covered[i] !== branchMessageIds[i]) {
      return false;
    }
  }
  return payload.anchor_message_id === covered[covered.length - 1];
};

// selectNewestValidCompaction returns the most useful valid compaction for the
// branch: the one covering the longest prefix (most context saved), breaking
// ties by newest creation time.
export const selectNewestValidCompaction = (
  compactions: readonly Compaction[],
  branchMessageIds: readonly string[],
): Compaction | null => {
  let best: Compaction | null = null;
  for (const candidate of compactions) {
    if (!isCompactionValidForBranch(candidate.payload, branchMessageIds)) {
      continue;
    }
    if (best === null) {
      best = candidate;
      continue;
    }
    const moreCoverage =
      candidate.payload.covered_message_ids.length >
      best.payload.covered_message_ids.length;
    const sameCoverageButNewer =
      candidate.payload.covered_message_ids.length ===
        best.payload.covered_message_ids.length &&
      candidate.createdAt.getTime() > best.createdAt.getTime();
    if (moreCoverage || sameCoverageButNewer) {
      best = candidate;
    }
  }
  return best;
};

// compactionsInvalidatedByMessage returns the record ids of every compaction
// whose summary represents the given message, including recursive fold-chain
// descendants that inherited that coverage (spec §12). Deleting a message must
// remove this whole lineage so its content cannot survive in any summary.
export const compactionsInvalidatedByMessage = (
  compactions: readonly Compaction[],
  messageId: string,
): string[] => {
  const directlyCovering = compactions.filter((c) =>
    c.payload.covered_message_ids.includes(messageId),
  );

  const invalidated = new Set<string>(directlyCovering.map((c) => c.recordId));

  // Walk descendants: any compaction whose parent is already invalidated is
  // itself invalidated, transitively.
  let changed = true;
  while (changed) {
    changed = false;
    for (const c of compactions) {
      if (invalidated.has(c.recordId)) {
        continue;
      }
      if (
        c.payload.parent_compaction_id &&
        invalidated.has(c.payload.parent_compaction_id)
      ) {
        invalidated.add(c.recordId);
        changed = true;
      }
    }
  }

  // parent_compaction_id references compaction record ids; map invalidated
  // payload-parent links back to record ids is already handled because record id
  // === the id stored as a child's parent_compaction_id.
  return [...invalidated];
};

// renderDurableMemory renders the durable-memory items as a plain bullet list.
// Returns '' when the list is empty.
const renderDurableMemory = (memory: CompactionPayload['durable_memory']): string =>
  memory.items.map((item) => `- ${item}`).join('\n');

// renderCompactionSummary renders a decrypted payload into the plain text the
// backend wraps in <conversation_summary> delimiters (spec §9.2). It mirrors the
// durable-memory + rolling-narrative structure.
export const renderCompactionSummary = (payload: CompactionPayload): string => {
  const lines: string[] = ['Durable memory:'];
  const memory = renderDurableMemory(payload.durable_memory);
  if (memory) {
    lines.push(memory);
  }
  if (payload.rolling_narrative.trim() !== '') {
    lines.push('Recent narrative:', payload.rolling_narrative.trim());
  }
  return lines.join('\n');
};

// renderConversationMemory combines the user-curated manual memory with the
// newest auto-compaction summary into the single block injected as
// context_summary. Either part may be absent; returns undefined when neither
// has content so no context_summary is sent.
export const renderConversationMemory = (
  manual: Compaction | null,
  prefix: Compaction | null,
): string | undefined => {
  const sections: string[] = [];
  if (manual) {
    const memory = renderDurableMemory(manual.payload.durable_memory);
    if (memory) {
      sections.push('User-curated memory:\n' + memory);
    }
  }
  if (prefix) {
    sections.push(renderCompactionSummary(prefix.payload));
  }
  return sections.length > 0 ? sections.join('\n\n') : undefined;
};

// renderCombinedMemory merges every memory scope into the single block injected
// as context_summary (spec §16): the user-curated conversation memory, the
// active-branch auto-compaction, plus project- and user-scoped memory. Each is
// optional; returns undefined when nothing has content. Ordered conversation →
// project → user (specific to general).
export const renderCombinedMemory = (input: {
  conversationManual: Compaction | null;
  conversationAuto: Compaction | null;
  projectMemory: ScopedMemory | null;
  userMemory: ScopedMemory | null;
}): string | undefined => {
  const sections: string[] = [];
  if (input.conversationManual) {
    const memory = renderDurableMemory(input.conversationManual.payload.durable_memory);
    if (memory) {
      sections.push('Conversation memory:\n' + memory);
    }
  }
  if (input.conversationAuto) {
    sections.push(renderCompactionSummary(input.conversationAuto.payload));
  }
  if (input.projectMemory) {
    const memory = renderDurableMemory(input.projectMemory.payload.durable_memory);
    if (memory) {
      sections.push('Project memory:\n' + memory);
    }
  }
  if (input.userMemory) {
    const memory = renderDurableMemory(input.userMemory.payload.durable_memory);
    if (memory) {
      sections.push('User memory:\n' + memory);
    }
  }
  return sections.length > 0 ? sections.join('\n\n') : undefined;
};

// selectManualMemory returns the conversation's manual-memory record (the
// branch-independent one with no covered messages), newest if several exist.
export const selectManualMemory = (
  compactions: readonly Compaction[],
): Compaction | null => {
  let best: Compaction | null = null;
  for (const candidate of compactions) {
    if (candidate.payload.covered_message_ids.length !== 0) {
      continue;
    }
    if (!best || candidate.createdAt.getTime() > best.createdAt.getTime()) {
      best = candidate;
    }
  }
  return best;
};

// emptyDurableMemory is the starting point for a fresh manual memory.
const emptyDurableMemory = (): CompactionPayload['durable_memory'] => ({
  items: [],
});

// CompactionPlanMessage is the minimal view of an active-branch message the
// planner needs.
export interface CompactionPlanMessage {
  recordId: string;
  role: 'user' | 'assistant';
  content: string;
}

// CompactionPlan describes the prefix to compact and (when folding) the parent
// it builds on.
export interface CompactionPlan {
  anchorMessageId: string;
  messages: {
    alias: string;
    messageId: string;
    role: 'user' | 'assistant';
    content: string;
  }[];
  parent: Compaction | null;
}

// COMPACTION_TRIGGER_FRACTION is the usable-context fraction at which background
// compaction starts (spec §10.1).
export const COMPACTION_TRIGGER_FRACTION = 0.7;
// COMPACTION_KEEP_RECENT_FRACTION of usable context is kept as a raw tail; the
// older prefix is what gets compacted (spec §10.3).
export const COMPACTION_KEEP_RECENT_FRACTION = 0.25;
// Minimum messages worth compacting — below this the savings aren't worth a
// provider call.
const MIN_MESSAGES_TO_COMPACT = 2;

// estimateRawContextChars sums the characters that would be sent raw: every
// branch message not already represented by the given compaction.
export const estimateRawContextChars = (
  branchOldestFirst: readonly CompactionPlanMessage[],
  activeCompaction: Compaction | null,
): number => {
  const covered = new Set(activeCompaction?.payload.covered_message_ids ?? []);
  let chars = activeCompaction
    ? renderCompactionSummary(activeCompaction.payload).length
    : 0;
  for (const message of branchOldestFirst) {
    if (covered.has(message.recordId)) {
      continue;
    }
    chars += message.content.length;
  }
  return chars;
};

// shouldTriggerCompaction reports whether the raw context has grown past the
// trigger fraction of usable context.
export const shouldTriggerCompaction = (
  estimatedRawChars: number,
  usableContextChars: number,
  fraction: number = COMPACTION_TRIGGER_FRACTION,
): boolean => {
  if (usableContextChars <= 0) {
    return false;
  }
  return estimatedRawChars >= fraction * usableContextChars;
};

// planCompaction decides which prefix of the active branch to compact and, when
// a valid compaction already exists, folds onto it by only compacting messages
// added since its anchor (spec §8.1, §10.3). Returns null when there is nothing
// worth compacting.
export const planCompaction = (
  branchOldestFirst: readonly CompactionPlanMessage[],
  options: {
    usableContextChars: number;
    existingValid: Compaction | null;
    keepRecentFraction?: number;
    minMessages?: number;
  },
): CompactionPlan | null => {
  const usable = branchOldestFirst.filter((m) => m.content.trim() !== '');
  const keepFraction = options.keepRecentFraction ?? COMPACTION_KEEP_RECENT_FRACTION;
  const keepRecentChars = options.usableContextChars * keepFraction;
  const minMessages = options.minMessages ?? MIN_MESSAGES_TO_COMPACT;

  // Walk newest-first, keeping the recent tail until it fills the keep budget.
  // Everything older than that is the candidate prefix to compact.
  let tailChars = 0;
  let cut = usable.length; // index of first kept (raw-tail) message
  for (let i = usable.length - 1; i >= 0; i--) {
    if (tailChars + usable[i].content.length > keepRecentChars) {
      break;
    }
    tailChars += usable[i].content.length;
    cut = i;
  }
  let prefix = usable.slice(0, cut);

  const parent = options.existingValid;
  if (parent) {
    // Fold: only compact messages added after the parent's anchor.
    const anchorIndex = usable.findIndex(
      (m) => m.recordId === parent.payload.anchor_message_id,
    );
    if (anchorIndex >= 0) {
      prefix = prefix.slice(anchorIndex + 1);
    }
  }

  if (prefix.length < minMessages) {
    return null;
  }

  return {
    anchorMessageId: prefix[prefix.length - 1].recordId,
    parent,
    messages: prefix.map((m, index) => ({
      alias: `M${index + 1}`,
      messageId: m.recordId,
      role: m.role,
      content: m.content,
    })),
  };
};

/**
 * CompactionService loads, decrypts, caches and mutates the encrypted
 * conversation compactions for the active conversation. Decryption happens here;
 * the API service stays pure transport. The planner (MessageService) reads the
 * cache synchronously when building completion context.
 */
@Injectable({ providedIn: 'root' })
export class CompactionService {
  private readonly _api = inject(CognosApiService);
  private readonly _cryptoService = inject(CryptoService);

  // Cache keyed by conversation id. A signal so future power-user UI can react,
  // but the planner reads it synchronously.
  private readonly _byConversation = signal<Map<string, Compaction[]>>(new Map());

  /** compactionsFor returns the cached, decrypted compactions for a conversation. */
  compactionsFor(conversationId: string): Compaction[] {
    return this._byConversation().get(conversationId) ?? [];
  }

  /** load fetches, decrypts and caches all compactions for a conversation. */
  load(conversationId: string, keyPair: KeyPair): Observable<Compaction[]> {
    return this._api.listCompactions(conversationId).pipe(
      map((records) => {
        const compactions = records
          .map((record) => this.decryptRecord(record, conversationId, keyPair))
          .filter((c): c is Compaction => c !== null);
        this.setCache(conversationId, compactions);
        return compactions;
      }),
    );
  }

  /** newestValidForBranch picks the best valid compaction for the active branch. */
  newestValidForBranch(
    conversationId: string,
    branchMessageIds: readonly string[],
  ): Compaction | null {
    return selectNewestValidCompaction(
      this.compactionsFor(conversationId),
      branchMessageIds,
    );
  }

  /**
   * create asks the backend to compact a prefix and caches the decrypted result.
   * Returns null when the backend skipped (e.g. ineligible model), so the caller
   * falls back to raw-tail truncation.
   */
  create(
    conversationId: string,
    request: ApiCreateCompactionRequest,
  ): Observable<Compaction | null> {
    return this._api.createCompaction(conversationId, request).pipe(
      map((response) => {
        const compaction = this.compactionFromCreateResponse(response, conversationId);
        if (compaction) {
          this.upsert(conversationId, compaction);
        }
        return compaction;
      }),
    );
  }

  /**
   * updateDurableMemory re-encrypts a compaction with edited durable memory and
   * persists the new ciphertext. The narrative and all other payload fields are
   * preserved; only durable_memory changes. The caller is responsible for having
   * re-redacted any edited text before passing it in (spec §8.2, §12.2).
   */
  updateDurableMemory(
    compaction: Compaction,
    durableMemory: CompactionPayload['durable_memory'],
    keyPair: KeyPair,
  ): Observable<Compaction> {
    const payload: CompactionPayload = {
      ...compaction.payload,
      durable_memory: durableMemory,
    };
    const sealed = this._cryptoService.createSealedBox(
      new TextEncoder().encode(JSON.stringify(payload)),
      keyPair.publicKey,
    );
    return this._api
      .updateCompaction(compaction.recordId, Base64.fromUint8Array(sealed))
      .pipe(
        map(() => {
          const updated: Compaction = { ...compaction, payload };
          this.upsert(compaction.conversationId, updated);
          return updated;
        }),
      );
  }

  /** manualMemoryFor returns the conversation's manual (user-curated) memory. */
  manualMemoryFor(conversationId: string): Compaction | null {
    return selectManualMemory(this.compactionsFor(conversationId));
  }

  /**
   * addManualFact appends a single user-pinned snippet to the conversation's
   * manual memory, creating the manual record if it does not exist yet (spec
   * §8.2). The caller must have re-redacted the snippet first.
   */
  addManualFact(
    conversationId: string,
    fact: string,
    keyPair: KeyPair,
  ): Observable<Compaction> {
    const existing = this.manualMemoryFor(conversationId);
    const base = existing?.payload.durable_memory ?? emptyDurableMemory();
    if (base.items.includes(fact) && existing) {
      return of(existing); // already pinned — no-op
    }
    return this.saveManualMemory(
      conversationId,
      { ...base, items: [...base.items, fact] },
      keyPair,
    );
  }

  /**
   * saveManualMemory persists edited manual memory, updating the existing record
   * or creating one (branch-independent, empty covered set) when absent.
   */
  saveManualMemory(
    conversationId: string,
    durableMemory: CompactionPayload['durable_memory'],
    keyPair: KeyPair,
  ): Observable<Compaction> {
    const existing = this.manualMemoryFor(conversationId);
    if (existing) {
      return this.updateDurableMemory(existing, durableMemory, keyPair);
    }
    const payload = this.buildManualPayload(conversationId, durableMemory);
    const sealed = this._cryptoService.createSealedBox(
      new TextEncoder().encode(JSON.stringify(payload)),
      keyPair.publicKey,
    );
    return this._api
      .createManualCompaction(conversationId, Base64.fromUint8Array(sealed))
      .pipe(
        map((record) => {
          const compaction: Compaction = {
            recordId: record.id,
            conversationId,
            createdAt: new Date(record.created),
            payload,
          };
          this.upsert(conversationId, compaction);
          return compaction;
        }),
      );
  }

  private buildManualPayload(
    conversationId: string,
    durableMemory: CompactionPayload['durable_memory'],
  ): CompactionPayload {
    return {
      version: '1',
      kind: 'conversation_compaction',
      conversation_id: conversationId,
      anchor_message_id: '',
      covered_message_ids: [],
      parent_compaction_id: '',
      compaction_level: 0,
      durable_memory: durableMemory,
      rolling_narrative: '',
      citations: [],
      source_token_estimate: 0,
      summary_token_estimate: 0,
      model_id: '',
      prompt_version: 'manual_v1',
      output_mode: 'manual',
      created_at: '',
    };
  }

  /**
   * invalidateForDeletedMessage deletes every compaction (and fold-chain
   * descendant) that represents the deleted message, so its content cannot
   * survive in any persisted summary (spec §12).
   */
  invalidateForDeletedMessage(
    conversationId: string,
    messageId: string,
  ): Observable<void> {
    const ids = compactionsInvalidatedByMessage(
      this.compactionsFor(conversationId),
      messageId,
    );
    if (ids.length === 0) {
      return of(undefined);
    }
    return forkJoin(ids.map((id) => this._api.deleteCompaction(id))).pipe(
      map(() => {
        this.removeMany(conversationId, ids);
      }),
    );
  }

  private decryptRecord(
    record: ApiCompactionRecord,
    conversationId: string,
    keyPair: KeyPair,
  ): Compaction | null {
    try {
      const plaintext = this._cryptoService.openSealedBox(
        Base64.toUint8Array(record.data),
        keyPair,
      );
      const payload = CompactionPayload.parse(
        JSON.parse(new TextDecoder().decode(plaintext)),
      );
      // Reject a payload that does not bind to this conversation (spec §11).
      if (payload.conversation_id !== conversationId) {
        return null;
      }
      return {
        recordId: record.id,
        conversationId,
        createdAt: new Date(record.created),
        payload,
      };
    } catch (error) {
      console.error('Compaction decryption failed', error);
      return null;
    }
  }

  private compactionFromCreateResponse(
    response: ApiCreateCompactionResponse,
    conversationId: string,
  ): Compaction | null {
    if (response.skipped || !response.payload) {
      return null;
    }
    const parsed = CompactionPayload.safeParse(response.payload);
    if (!parsed.success || parsed.data.conversation_id !== conversationId) {
      return null;
    }
    return {
      recordId: response.id,
      conversationId,
      createdAt: new Date(response.created),
      payload: parsed.data,
    };
  }

  private setCache(conversationId: string, compactions: Compaction[]): void {
    const next = new Map(this._byConversation());
    next.set(conversationId, compactions);
    this._byConversation.set(next);
  }

  private upsert(conversationId: string, compaction: Compaction): void {
    const current = this.compactionsFor(conversationId).filter(
      (c) => c.recordId !== compaction.recordId,
    );
    this.setCache(conversationId, [...current, compaction]);
  }

  private removeMany(conversationId: string, recordIds: string[]): void {
    const remove = new Set(recordIds);
    this.setCache(
      conversationId,
      this.compactionsFor(conversationId).filter((c) => !remove.has(c.recordId)),
    );
  }
}
