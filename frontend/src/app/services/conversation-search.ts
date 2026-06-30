// Pure, framework-free building blocks for the browser-only conversation search
// index (spec: docs/specs/conversation-search.md). Kept separate from the
// Angular service so the index logic — schema, document shape, message joining,
// ranking — is unit-testable without TestBed and never logs decrypted text.
import {
  type AnyOrama,
  type Results,
  create,
  insert,
  remove,
  search,
} from '@orama/orama';

import { Conversation, ConversationRecord } from '@app/interfaces/conversation';
import { parseBackendDate } from '@app/utils/timestamp';

// Tuning + bounds (spec §8, §9).
export const SEARCH_MIN_QUERY_LENGTH = 3;
export const SEARCH_DEBOUNCE_MS = 400;
export const SEARCH_HYDRATION_BATCH = 10;
export const RECENT_MESSAGES_CAP_BYTES = 8192;

// One Orama document per conversation (spec §7). `recentMessages` stays empty
// until the conversation is hydrated. `projectId` is '' for standalone chats so
// the field is always a string (Orama indexes it uniformly).
export interface ConversationSearchDocument {
  id: string;
  title: string;
  recentMessages: string;
  updatedMs: number;
  projectId: string;
}

const SEARCH_SCHEMA = {
  id: 'string',
  title: 'string',
  recentMessages: 'string',
  updatedMs: 'number',
  projectId: 'string',
} as const;

// Orama stems for one language per index. We bind it to the user's active UI
// locale (spec §8.1) — all six supported locales map to an Orama stemmer.
export type OramaLanguage =
  | 'english'
  | 'german'
  | 'french'
  | 'spanish'
  | 'portuguese'
  | 'italian';

const LANGUAGE_BY_CODE: Readonly<Record<string, OramaLanguage>> = {
  en: 'english',
  de: 'german',
  fr: 'french',
  es: 'spanish',
  pt: 'portuguese',
  it: 'italian',
};

export const oramaLanguageFor = (code: string | undefined | null): OramaLanguage =>
  (code ? LANGUAGE_BY_CODE[code] : undefined) ?? 'english';

// A minimal stemmer shape so callers can lazy-load `@orama/stemmers/<lang>`
// without this module importing every stemmer.
export type Stemmer = (word: string) => string;

/**
 * createConversationSearchDb builds an empty index for the given language.
 * When a stemmer is supplied, stemming is enabled (the common monolingual
 * case); otherwise the tokenizer is language-neutral (no stemming).
 */
export const createConversationSearchDb = (
  language: OramaLanguage,
  stemmer?: Stemmer,
): AnyOrama =>
  create({
    schema: SEARCH_SCHEMA,
    components: {
      tokenizer: {
        language,
        stemming: stemmer !== undefined,
        stemmer,
      },
    },
  }) as AnyOrama;

// updatedMs prefers the explicit activity timestamp, falling back to the row's
// generic updated time — matching the sidebar's ordering rule.
const conversationUpdatedMs = (record: ConversationRecord): number => {
  const ms = parseBackendDate(record.last_activity_at || record.updated).getTime();
  return Number.isNaN(ms) ? 0 : ms;
};

export const toSearchDocument = (
  conversation: Conversation,
  recentMessages = '',
): ConversationSearchDocument => ({
  id: conversation.record.id,
  title: conversation.decryptedData.title,
  recentMessages,
  updatedMs: conversationUpdatedMs(conversation.record),
  projectId: conversation.record.project ?? '',
});

// upsertSearchDocument replaces a document in place (Orama treats updates as
// remove + insert). Tolerates a missing prior document.
export const upsertSearchDocument = (
  db: AnyOrama,
  document: ConversationSearchDocument,
): void => {
  try {
    remove(db, document.id);
  } catch {
    // Not present yet — first insert.
  }
  insert(db, document as never);
};

/**
 * buildRecentMessages joins decrypted message `content` newest-first into the
 * indexable blob (spec §7.1):
 *   - only `content`; reasoning is never passed in;
 *   - tombstoned messages (deleted flag or null content) are skipped;
 *   - capped at ~8 KB so a long chat can't dominate the index.
 */
export const buildRecentMessages = (
  messagesNewestFirst: ReadonlyArray<{ content: string | null; deleted?: boolean }>,
  capBytes: number = RECENT_MESSAGES_CAP_BYTES,
): string => {
  const encoder = new TextEncoder();
  const parts: string[] = [];
  let bytes = 0;

  for (const message of messagesNewestFirst) {
    if (message.deleted) continue;
    const content = message.content?.trim();
    if (!content) continue;

    // Account for the joining newline once we have a first part.
    const addition = parts.length === 0 ? content : `\n${content}`;
    const size = encoder.encode(addition).length;
    if (bytes + size > capBytes) break;

    parts.push(content);
    bytes += size;
  }

  return parts.join('\n');
};

export interface ConversationSearchHit {
  id: string;
  score: number;
  updatedMs: number;
}

/**
 * searchConversationIndex runs the BM25 query and returns hits ordered by score
 * then recency (spec §6.2, §8). `threshold: 0` requires all query terms;
 * `tolerance: 1` is the typo/inflection recall safety net.
 */
export const searchConversationIndex = (
  db: AnyOrama,
  term: string,
): ConversationSearchHit[] => {
  const results = search(db, {
    term,
    properties: ['title', 'recentMessages'],
    boost: { title: 4, recentMessages: 1 },
    threshold: 0,
    tolerance: 1,
    relevance: { k: 1.2, b: 0.75, d: 0.5 },
  }) as Results<ConversationSearchDocument>;

  return results.hits
    .map((hit) => ({
      id: hit.document.id,
      score: hit.score,
      updatedMs: hit.document.updatedMs,
    }))
    .sort((a, b) => b.score - a.score || b.updatedMs - a.updatedMs);
};

// searchCacheKey changes whenever a conversation's activity does, so hydrated
// message text is reused while the conversation is untouched and discarded once
// it changes (spec §10).
export const searchCacheKey = (
  record: Pick<ConversationRecord, 'id' | 'last_activity_at' | 'updated'>,
): string => `${record.id}:${record.last_activity_at || record.updated}`;
