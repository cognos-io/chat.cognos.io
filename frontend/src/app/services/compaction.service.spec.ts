import { describe, expect, it } from 'vitest';

import { Compaction, CompactionPayload } from '@app/interfaces/compaction';

import {
  CompactionPlanMessage,
  compactionsInvalidatedByMessage,
  estimateRawContextChars,
  isCompactionValidForBranch,
  planCompaction,
  renderCompactionSummary,
  renderConversationMemory,
  selectManualMemory,
  selectNewestValidCompaction,
  shouldTriggerCompaction,
} from './compaction.service';

const payload = (overrides: Partial<CompactionPayload> = {}): CompactionPayload => ({
  version: '1',
  kind: 'conversation_compaction',
  conversation_id: 'conv1',
  anchor_message_id: 'm3',
  covered_message_ids: ['m1', 'm2', 'm3'],
  parent_compaction_id: '',
  compaction_level: 0,
  durable_memory: { facts: [], decisions: [], open_threads: [], glossary: [] },
  rolling_narrative: '',
  citations: [],
  source_token_estimate: 0,
  summary_token_estimate: 0,
  model_id: 'model-x',
  prompt_version: 'compaction_v1',
  output_mode: 'delimited_text',
  created_at: '2026-06-25T00:00:00Z',
  ...overrides,
});

const compaction = (
  recordId: string,
  overrides: Partial<CompactionPayload> = {},
  createdAt = '2026-06-25T00:00:00Z',
): Compaction => ({
  recordId,
  conversationId: 'conv1',
  createdAt: new Date(createdAt),
  payload: payload(overrides),
});

describe('isCompactionValidForBranch', () => {
  it('accepts a compaction whose covered set is a contiguous prefix ending at the anchor', () => {
    expect(isCompactionValidForBranch(payload(), ['m1', 'm2', 'm3', 'm4', 'm5'])).toBe(
      true,
    );
  });

  it('reuses a prefix compaction across a sibling branch sharing that history', () => {
    // Different tail (m4b instead of m4) but the same m1..m3 prefix — still valid.
    expect(isCompactionValidForBranch(payload(), ['m1', 'm2', 'm3', 'm4b'])).toBe(true);
  });

  it('rejects when the branch diverges within the covered prefix', () => {
    expect(isCompactionValidForBranch(payload(), ['m1', 'mX', 'm3', 'm4'])).toBe(false);
  });

  it('rejects when covered is longer than the branch', () => {
    expect(isCompactionValidForBranch(payload(), ['m1', 'm2'])).toBe(false);
  });

  it('rejects an empty covered set', () => {
    expect(
      isCompactionValidForBranch(payload({ covered_message_ids: [] }), ['m1']),
    ).toBe(false);
  });

  it('rejects when the anchor is not the last covered message', () => {
    expect(
      isCompactionValidForBranch(payload({ anchor_message_id: 'm2' }), [
        'm1',
        'm2',
        'm3',
      ]),
    ).toBe(false);
  });
});

describe('selectNewestValidCompaction', () => {
  const branch = ['m1', 'm2', 'm3', 'm4', 'm5'];

  it('returns null when nothing is valid', () => {
    const sibling = compaction('c1', {
      covered_message_ids: ['mX'],
      anchor_message_id: 'mX',
    });
    expect(selectNewestValidCompaction([sibling], branch)).toBeNull();
  });

  it('prefers the compaction covering the longest prefix', () => {
    const small = compaction('small', {
      covered_message_ids: ['m1', 'm2'],
      anchor_message_id: 'm2',
    });
    const big = compaction('big', {
      covered_message_ids: ['m1', 'm2', 'm3', 'm4'],
      anchor_message_id: 'm4',
    });
    expect(selectNewestValidCompaction([small, big], branch)?.recordId).toBe('big');
  });

  it('breaks coverage ties by newest creation time', () => {
    const older = compaction(
      'older',
      { covered_message_ids: ['m1', 'm2', 'm3'], anchor_message_id: 'm3' },
      '2026-06-25T00:00:00Z',
    );
    const newer = compaction(
      'newer',
      { covered_message_ids: ['m1', 'm2', 'm3'], anchor_message_id: 'm3' },
      '2026-06-26T00:00:00Z',
    );
    expect(selectNewestValidCompaction([older, newer], branch)?.recordId).toBe('newer');
  });
});

describe('compactionsInvalidatedByMessage', () => {
  it('returns compactions directly covering the deleted message', () => {
    const c = compaction('c1', {
      covered_message_ids: ['m1', 'm2'],
      anchor_message_id: 'm2',
    });
    expect(compactionsInvalidatedByMessage([c], 'm2')).toEqual(['c1']);
  });

  it('includes fold-chain descendants of a covering compaction', () => {
    // c1 covers m1..m2; c2 folded c1 (parent = c1) covering m1..m4; c3 folded c2.
    const c1 = compaction('c1', {
      covered_message_ids: ['m1', 'm2'],
      anchor_message_id: 'm2',
    });
    const c2 = compaction('c2', {
      covered_message_ids: ['m1', 'm2', 'm3', 'm4'],
      anchor_message_id: 'm4',
      parent_compaction_id: 'c1',
    });
    const c3 = compaction('c3', {
      covered_message_ids: ['m1', 'm2', 'm3', 'm4', 'm5', 'm6'],
      anchor_message_id: 'm6',
      parent_compaction_id: 'c2',
    });
    const got = compactionsInvalidatedByMessage([c1, c2, c3], 'm1').sort();
    expect(got).toEqual(['c1', 'c2', 'c3']);
  });

  it('returns nothing when no compaction covers the message', () => {
    const c = compaction('c1', {
      covered_message_ids: ['m1'],
      anchor_message_id: 'm1',
    });
    expect(compactionsInvalidatedByMessage([c], 'm9')).toEqual([]);
  });
});

describe('shouldTriggerCompaction', () => {
  it('fires at or above the trigger fraction', () => {
    expect(shouldTriggerCompaction(70, 100, 0.7)).toBe(true);
    expect(shouldTriggerCompaction(80, 100, 0.7)).toBe(true);
  });

  it('does not fire below the fraction', () => {
    expect(shouldTriggerCompaction(69, 100, 0.7)).toBe(false);
  });

  it('never fires with non-positive usable context', () => {
    expect(shouldTriggerCompaction(50, 0, 0.7)).toBe(false);
  });
});

describe('estimateRawContextChars', () => {
  const branch: CompactionPlanMessage[] = [
    { recordId: 'm1', role: 'user', content: '0123456789' },
    { recordId: 'm2', role: 'assistant', content: '0123456789' },
    { recordId: 'm3', role: 'user', content: '0123456789' },
  ];

  it('sums all message chars when there is no compaction', () => {
    expect(estimateRawContextChars(branch, null)).toBe(30);
  });

  it('replaces covered messages with the rendered summary length', () => {
    const c = compaction('c1', {
      covered_message_ids: ['m1', 'm2'],
      anchor_message_id: 'm2',
      durable_memory: { facts: ['x'], decisions: [], open_threads: [], glossary: [] },
    });
    const summaryLen = renderCompactionSummary(c.payload).length;
    // m1+m2 covered (excluded), m3 raw (10) plus the summary text.
    expect(estimateRawContextChars(branch, c)).toBe(summaryLen + 10);
  });
});

describe('planCompaction', () => {
  const branch: CompactionPlanMessage[] = Array.from({ length: 6 }, (_, i) => ({
    recordId: `m${i + 1}`,
    role: i % 2 === 0 ? 'user' : 'assistant',
    content: '0123456789', // 10 chars each
  }));

  it('compacts the older prefix and keeps the recent tail (leaf)', () => {
    // keepRecentChars = 100 * 0.25 = 25 -> keeps m5,m6 raw; prefix = m1..m4.
    const plan = planCompaction(branch, {
      usableContextChars: 100,
      existingValid: null,
    });
    expect(plan).not.toBeNull();
    expect(plan!.parent).toBeNull();
    expect(plan!.anchorMessageId).toBe('m4');
    expect(plan!.messages.map((m) => m.messageId)).toEqual(['m1', 'm2', 'm3', 'm4']);
    expect(plan!.messages.map((m) => m.alias)).toEqual(['M1', 'M2', 'M3', 'M4']);
  });

  it('folds onto an existing compaction by compacting only messages after its anchor', () => {
    const parent = compaction('parent', {
      covered_message_ids: ['m1', 'm2'],
      anchor_message_id: 'm2',
    });
    const plan = planCompaction(branch, {
      usableContextChars: 100,
      existingValid: parent,
    });
    expect(plan).not.toBeNull();
    expect(plan!.parent?.recordId).toBe('parent');
    // prefix m1..m4, minus through-parent-anchor (m2) -> m3,m4.
    expect(plan!.messages.map((m) => m.messageId)).toEqual(['m3', 'm4']);
    expect(plan!.anchorMessageId).toBe('m4');
  });

  it('returns null when the prefix is too small to be worth compacting', () => {
    // Huge keep budget -> everything stays in the raw tail, nothing to compact.
    const plan = planCompaction(branch, {
      usableContextChars: 100000,
      existingValid: null,
    });
    expect(plan).toBeNull();
  });
});

describe('selectManualMemory', () => {
  it('returns the newest record with no covered messages', () => {
    const auto = compaction('auto', {
      covered_message_ids: ['m1', 'm2'],
      anchor_message_id: 'm2',
    });
    const manualOld = compaction(
      'manual-old',
      { covered_message_ids: [], anchor_message_id: '' },
      '2026-06-25T00:00:00Z',
    );
    const manualNew = compaction(
      'manual-new',
      { covered_message_ids: [], anchor_message_id: '' },
      '2026-06-26T00:00:00Z',
    );
    expect(selectManualMemory([auto, manualOld, manualNew])?.recordId).toBe(
      'manual-new',
    );
  });

  it('returns null when only covered (auto) compactions exist', () => {
    const auto = compaction('auto', {
      covered_message_ids: ['m1'],
      anchor_message_id: 'm1',
    });
    expect(selectManualMemory([auto])).toBeNull();
  });
});

describe('renderConversationMemory', () => {
  const manual = compaction('manual', {
    covered_message_ids: [],
    anchor_message_id: '',
    durable_memory: {
      facts: ['Pinned: deploys on Infomaniak'],
      decisions: [],
      open_threads: [],
      glossary: [],
    },
  });
  const auto = compaction('auto', {
    covered_message_ids: ['m1', 'm2'],
    anchor_message_id: 'm2',
    rolling_narrative: 'AUTO_NARRATIVE',
  });

  it('combines curated memory and the auto summary', () => {
    const text = renderConversationMemory(manual, auto);
    expect(text).toContain('User-curated memory:');
    expect(text).toContain('Pinned: deploys on Infomaniak');
    expect(text).toContain('AUTO_NARRATIVE');
  });

  it('renders only curated memory when there is no auto compaction', () => {
    const text = renderConversationMemory(manual, null);
    expect(text).toContain('Pinned: deploys on Infomaniak');
    expect(text).not.toContain('Recent narrative');
  });

  it('returns undefined when neither has content', () => {
    expect(renderConversationMemory(null, null)).toBeUndefined();
  });
});

describe('renderCompactionSummary', () => {
  it('renders durable memory sections and the narrative, skipping empty parts', () => {
    const text = renderCompactionSummary(
      payload({
        durable_memory: {
          facts: ['Prefers Postgres'],
          decisions: ['Use pgx'],
          open_threads: [],
          glossary: [{ term: '[[PII_EMAIL_A8F2KD]]', note: 'work email' }],
        },
        rolling_narrative: 'Discussed the driver choice.',
      }),
    );
    expect(text).toContain('Facts');
    expect(text).toContain('Prefers Postgres');
    expect(text).toContain('Use pgx');
    expect(text).toContain('[[PII_EMAIL_A8F2KD]]');
    expect(text).toContain('Recent narrative:');
    expect(text).toContain('Discussed the driver choice.');
    // open_threads was empty, so its heading must not appear.
    expect(text).not.toContain('Open threads');
  });
});
