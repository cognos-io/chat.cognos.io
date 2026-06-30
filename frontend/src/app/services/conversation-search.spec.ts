import { stemmer as englishStemmer } from '@orama/stemmers/english';
import { describe, expect, it } from 'vitest';

import {
  ConversationSearchDocument,
  buildRecentMessages,
  createConversationSearchDb,
  oramaLanguageFor,
  searchCacheKey,
  searchConversationIndex,
  upsertSearchDocument,
} from './conversation-search';

const doc = (
  overrides: Partial<ConversationSearchDocument>,
): ConversationSearchDocument => ({
  id: 'c1',
  title: '',
  recentMessages: '',
  updatedMs: 0,
  projectId: '',
  ...overrides,
});

describe('oramaLanguageFor', () => {
  it('maps each supported UI locale to its Orama stemmer language', () => {
    expect(oramaLanguageFor('en')).toBe('english');
    expect(oramaLanguageFor('de')).toBe('german');
    expect(oramaLanguageFor('fr')).toBe('french');
    expect(oramaLanguageFor('es')).toBe('spanish');
    expect(oramaLanguageFor('pt')).toBe('portuguese');
    expect(oramaLanguageFor('it')).toBe('italian');
  });

  it('defaults to english for unknown or missing locales', () => {
    expect(oramaLanguageFor('zh')).toBe('english');
    expect(oramaLanguageFor(undefined)).toBe('english');
    expect(oramaLanguageFor(null)).toBe('english');
  });
});

describe('buildRecentMessages', () => {
  it('joins decrypted content newest-first', () => {
    const joined = buildRecentMessages([{ content: 'newest' }, { content: 'older' }]);
    expect(joined).toBe('newest\nolder');
  });

  it('skips tombstoned messages (deleted flag) and null/empty content', () => {
    const joined = buildRecentMessages([
      { content: 'kept' },
      { content: 'gone', deleted: true },
      { content: null },
      { content: '   ' },
    ]);
    expect(joined).toBe('kept');
  });

  it('caps the joined string at the byte budget', () => {
    const joined = buildRecentMessages(
      [{ content: 'aaaa' }, { content: 'bbbb' }, { content: 'cccc' }],
      4,
    );
    // First 4-byte chunk fits; the next would push past the cap.
    expect(joined).toBe('aaaa');
  });
});

describe('searchCacheKey', () => {
  it('keys on last_activity_at when present', () => {
    expect(searchCacheKey({ id: 'c1', last_activity_at: 'A', updated: 'U' })).toBe(
      'c1:A',
    );
  });

  it('falls back to updated when there is no activity timestamp', () => {
    expect(searchCacheKey({ id: 'c1', updated: 'U' })).toBe('c1:U');
  });
});

describe('searchConversationIndex', () => {
  it('returns a title match immediately', () => {
    const db = createConversationSearchDb('english');
    upsertSearchDocument(db, doc({ id: 'c1', title: 'Lease agreement' }));

    const hits = searchConversationIndex(db, 'lease');
    expect(hits.map((h) => h.id)).toEqual(['c1']);
  });

  it('matches on hydrated recent message content', () => {
    const db = createConversationSearchDb('english');
    // Title-only first: no message hit yet.
    upsertSearchDocument(db, doc({ id: 'c1', title: 'Catch up' }));
    expect(searchConversationIndex(db, 'mortgage')).toEqual([]);

    // Hydrate the message text → now it matches.
    upsertSearchDocument(
      db,
      doc({ id: 'c1', title: 'Catch up', recentMessages: 'about the mortgage rate' }),
    );
    expect(searchConversationIndex(db, 'mortgage').map((h) => h.id)).toEqual(['c1']);
  });

  it('ranks a title hit above a message-only hit for the same term', () => {
    const db = createConversationSearchDb('english');
    upsertSearchDocument(db, doc({ id: 'title-hit', title: 'Budget planning' }));
    upsertSearchDocument(
      db,
      doc({
        id: 'message-hit',
        title: 'Random chat',
        recentMessages: 'budget budget budget',
      }),
    );

    const hits = searchConversationIndex(db, 'budget');
    expect(hits[0].id).toBe('title-hit');
  });

  it('requires all query terms (threshold 0)', () => {
    const db = createConversationSearchDb('english');
    upsertSearchDocument(db, doc({ id: 'both', title: 'lease clause negotiation' }));
    upsertSearchDocument(db, doc({ id: 'one', title: 'lease renewal date' }));

    const ids = searchConversationIndex(db, 'lease clause').map((h) => h.id);
    expect(ids).toContain('both');
    expect(ids).not.toContain('one');
  });

  it('tolerates a single-character typo', () => {
    const db = createConversationSearchDb('english');
    upsertSearchDocument(db, doc({ id: 'c1', title: 'lease agreement' }));

    expect(searchConversationIndex(db, 'leasse').map((h) => h.id)).toEqual(['c1']);
  });

  it('matches inflected forms via the active-language stemmer', () => {
    const db = createConversationSearchDb('english', englishStemmer);
    upsertSearchDocument(db, doc({ id: 'c1', title: 'signing the leases' }));

    // "lease" stems to the same root as "leases" → match without a typo budget.
    expect(searchConversationIndex(db, 'lease').map((h) => h.id)).toEqual(['c1']);
  });

  it('breaks score ties by recency (newest first)', () => {
    const db = createConversationSearchDb('english');
    upsertSearchDocument(db, doc({ id: 'old', title: 'lease', updatedMs: 1 }));
    upsertSearchDocument(db, doc({ id: 'new', title: 'lease', updatedMs: 2 }));

    expect(searchConversationIndex(db, 'lease').map((h) => h.id)).toEqual([
      'new',
      'old',
    ]);
  });
});
