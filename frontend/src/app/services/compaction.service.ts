import { Injectable, inject, signal } from '@angular/core';

import { Observable, forkJoin, map, of } from 'rxjs';

import { Base64 } from 'js-base64';

import { Compaction, CompactionPayload } from '@app/interfaces/compaction';
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

// renderCompactionSummary renders a decrypted payload into the plain text the
// backend wraps in <conversation_summary> delimiters (spec §9.2). It mirrors the
// durable-memory + rolling-narrative structure.
export const renderCompactionSummary = (payload: CompactionPayload): string => {
  const { durable_memory: memory, rolling_narrative: narrative } = payload;
  const lines: string[] = ['Durable memory:'];
  const appendList = (label: string, items: string[]): void => {
    if (items.length === 0) {
      return;
    }
    lines.push(`- ${label}:`);
    for (const item of items) {
      lines.push(`  - ${item}`);
    }
  };
  appendList('Facts', memory.facts);
  appendList('Decisions', memory.decisions);
  appendList('Open threads', memory.open_threads);
  if (memory.glossary.length > 0) {
    lines.push('- Glossary:');
    for (const entry of memory.glossary) {
      lines.push(`  - ${entry.term}: ${entry.note}`);
    }
  }
  if (narrative.trim() !== '') {
    lines.push('Recent narrative:', narrative.trim());
  }
  return lines.join('\n');
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
