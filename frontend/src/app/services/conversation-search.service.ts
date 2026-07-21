import { Injectable, InjectionToken, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed, toObservable } from '@angular/core/rxjs-interop';

import {
  EMPTY,
  Observable,
  Subject,
  catchError,
  combineLatest,
  concat,
  debounceTime,
  distinctUntilChanged,
  forkJoin,
  map,
  of,
  switchMap,
  tap,
} from 'rxjs';

import { type AnyOrama, remove } from '@orama/orama';

import { Conversation, sortConversationsByUpdated } from '@app/interfaces/conversation';
import { decryptMessageData } from '@app/interfaces/message';

import { CognosApiService } from './cognos-api.service';
import {
  OramaLanguage,
  SEARCH_DEBOUNCE_MS,
  SEARCH_HYDRATION_BATCH,
  SEARCH_MIN_QUERY_LENGTH,
  Stemmer,
  buildRecentMessages,
  createConversationSearchDb,
  oramaLanguageFor,
  searchCacheKey,
  searchConversationIndex,
  toSearchDocument,
  upsertSearchDocument,
} from './conversation-search';
import { ConversationService } from './conversation.service';
import { CryptoService } from './crypto.service';
import { LanguageService } from './language.service';
import { ProjectConversationService } from './project-conversation.service';
import { VaultService } from './vault.service';

// Lazy stemmer import per locale — only the active language's stemmer is ever
// fetched, so the search bundle stays small (spec §8.1). Injectable so tests can
// supply a deterministic loader instead of a dynamic import.
export type StemmerLoader = (language: OramaLanguage) => Promise<Stemmer | undefined>;

const STEMMER_IMPORTS: Record<OramaLanguage, () => Promise<{ stemmer: Stemmer }>> = {
  english: () => import('@orama/stemmers/english'),
  german: () => import('@orama/stemmers/german'),
  french: () => import('@orama/stemmers/french'),
  spanish: () => import('@orama/stemmers/spanish'),
  portuguese: () => import('@orama/stemmers/portuguese'),
  italian: () => import('@orama/stemmers/italian'),
};

const defaultStemmerLoader: StemmerLoader = async (language) => {
  try {
    return (await STEMMER_IMPORTS[language]()).stemmer;
  } catch {
    // Fall back to language-neutral tokenization rather than failing search.
    return undefined;
  }
};

export const CONVERSATION_SEARCH_STEMMER_LOADER = new InjectionToken<StemmerLoader>(
  'CONVERSATION_SEARCH_STEMMER_LOADER',
  { factory: () => defaultStemmerLoader },
);

interface HydrationCacheEntry {
  recentMessages: string;
  cacheKey: string;
}

/**
 * ConversationSearchService owns the browser-only BM25 search index over
 * decrypted chat titles and lazily-hydrated recent messages (spec:
 * docs/business_processes/conversation-search-index.md). It replaces the old substring filter:
 * the sidebar binds its input here and renders `results()` when `isActive()`.
 *
 * Security: it decrypts via a stateless helper (never MessageService, so the
 * open chat is untouched), never logs queries or plaintext, and is torn down
 * whenever the vault locks or the user logs out.
 */
@Injectable({ providedIn: 'root' })
export class ConversationSearchService {
  private readonly _vault = inject(VaultService);
  private readonly _conversations = inject(ConversationService);
  private readonly _api = inject(CognosApiService);
  private readonly _crypto = inject(CryptoService);
  private readonly _language = inject(LanguageService);
  private readonly _loadStemmer = inject(CONVERSATION_SEARCH_STEMMER_LOADER);
  // Injected so its eager project-conversation load is active: project chats are
  // merged into ConversationService and therefore covered by search (spec §9.2).
  private readonly _projectConversations = inject(ProjectConversationService);

  private _db: AnyOrama | null = null;
  private _dbLanguage: OramaLanguage | null = null;
  private _dbHasStemmer = false;
  private _indexedIds = new Set<string>();
  private readonly _cache = new Map<string, HydrationCacheEntry>();

  readonly query$ = new Subject<string>();

  private readonly _query = signal('');
  private readonly _resultIds = signal<string[]>([]);
  private readonly _isHydrating = signal(false);

  /** The active, trimmed query (empty when search is not active). */
  readonly query = this._query.asReadonly();
  /** True once the query is long enough to drive a search result list. */
  readonly isActive = computed(() => this._query().length >= SEARCH_MIN_QUERY_LENGTH);
  readonly isHydrating = this._isHydrating.asReadonly();

  /** Scored search results as conversations, ordered by the index. */
  readonly results = computed<Conversation[]>(() => {
    const byId = new Map(
      this._conversations.allConversations().map((c) => [c.record.id, c]),
    );
    return this._resultIds()
      .map((id) => byId.get(id))
      .filter((c): c is Conversation => c !== undefined);
  });
  readonly hasResults = computed(() => this.results().length > 0);
  /** Show the empty state only once hydration has settled with no hits. */
  readonly showNoResults = computed(
    () => this.isActive() && !this._isHydrating() && this.results().length === 0,
  );

  constructor() {
    // Index lifecycle: (re)build on unlock, conversation-list change, or locale
    // change; tear down on lock/logout (keyPair → undefined). debounceTime
    // coalesces the burst of upserts that lands as conversations decrypt.
    combineLatest({
      keyPair: this._vault.keyPair$,
      conversations: toObservable(this._conversations.allConversations),
      language: toObservable(this._language.current),
    })
      .pipe(debounceTime(50), takeUntilDestroyed())
      .subscribe(({ keyPair, conversations, language }) => {
        if (!keyPair) {
          this.teardown();
          return;
        }
        this.syncIndex(conversations, oramaLanguageFor(language));
      });

    // Search pipeline. switchMap is the race guard: a new query tears down the
    // previous query's hydration, cancelling its in-flight message fetches
    // (spec §12.2). Clearing/short queries reset immediately in setQuery().
    this.query$
      .pipe(
        debounceTime(SEARCH_DEBOUNCE_MS),
        map((value) => value.trim()),
        distinctUntilChanged(),
        tap((query) => this._query.set(query)),
        switchMap((query) => {
          if (query.length < SEARCH_MIN_QUERY_LENGTH) {
            this._isHydrating.set(false);
            this._resultIds.set([]);
            return EMPTY;
          }
          return this.hydrateAndSearch$(query);
        }),
        takeUntilDestroyed(),
      )
      .subscribe((ids) => this._resultIds.set(ids));
  }

  /** Sidebar entry point. Short/empty input resets to normal navigation now. */
  setQuery(value: string): void {
    if (value.trim().length < SEARCH_MIN_QUERY_LENGTH) {
      this._query.set('');
      this._resultIds.set([]);
      this._isHydrating.set(false);
    }
    this.query$.next(value);
  }

  // --- index ---------------------------------------------------------------

  private syncIndex(conversations: Conversation[], language: OramaLanguage): void {
    if (!this._db || this._dbLanguage !== language) {
      this.rebuildDb(language, undefined);
      // Upgrade to the locale's stemmer in the background; the title index is
      // already usable language-neutral, so first searches don't wait on it.
      void this.loadStemmerInto(language);
    }

    const db = this._db!;
    const present = new Set<string>();

    for (const conversation of conversations) {
      const id = conversation.record.id;
      present.add(id);
      const key = searchCacheKey(conversation.record);
      const cached = this._cache.get(id);
      const valid = cached?.cacheKey === key;
      if (!valid && cached) {
        this._cache.delete(id); // activity changed → drop stale hydrated text
      }
      upsertSearchDocument(
        db,
        toSearchDocument(conversation, valid ? cached!.recentMessages : ''),
      );
    }

    for (const id of this._indexedIds) {
      if (!present.has(id)) {
        this.removeDocument(db, id);
        this._cache.delete(id);
      }
    }
    this._indexedIds = present;

    if (this.isActive()) {
      this._resultIds.set(this.rankIds(this._query()));
    }
  }

  private rebuildDb(language: OramaLanguage, stemmer: Stemmer | undefined): void {
    this._db = createConversationSearchDb(language, stemmer);
    this._dbLanguage = language;
    this._dbHasStemmer = stemmer !== undefined;
    this._indexedIds = new Set();
  }

  private async loadStemmerInto(language: OramaLanguage): Promise<void> {
    const stemmer = await this._loadStemmer(language);
    if (!stemmer) return;
    // Bail if the locale changed again, the vault locked, or a stemmer already
    // landed while we were importing.
    if (this._dbLanguage !== language || this._dbHasStemmer || !this._db) return;

    this.rebuildDb(language, stemmer);
    const db = this._db!;
    for (const conversation of this._conversations.allConversations()) {
      const cached = this._cache.get(conversation.record.id);
      const valid = cached?.cacheKey === searchCacheKey(conversation.record);
      upsertSearchDocument(
        db,
        toSearchDocument(conversation, valid ? cached!.recentMessages : ''),
      );
      this._indexedIds.add(conversation.record.id);
    }
    if (this.isActive()) {
      this._resultIds.set(this.rankIds(this._query()));
    }
  }

  private removeDocument(db: AnyOrama, id: string): void {
    try {
      remove(db, id);
    } catch {
      // Already absent — nothing to do.
    }
  }

  private teardown(): void {
    this._db = null;
    this._dbLanguage = null;
    this._dbHasStemmer = false;
    this._indexedIds = new Set();
    this._cache.clear();
    this._resultIds.set([]);
    this._query.set('');
    this._isHydrating.set(false);
  }

  // --- search + hydration --------------------------------------------------

  private rankIds(query: string): string[] {
    if (!this._db) return [];
    return searchConversationIndex(this._db, query).map((hit) => hit.id);
  }

  private hydrateAndSearch$(query: string): Observable<string[]> {
    if (!this._db) return of([]);

    const immediate = this.rankIds(query);
    const candidates = this.hydrationCandidates();
    if (candidates.length === 0) {
      this._isHydrating.set(false);
      return of(immediate);
    }

    this._isHydrating.set(true);
    return concat(
      of(immediate),
      forkJoin(candidates.map((conversation) => this.hydrate$(conversation))).pipe(
        map(() => this.rankIds(query)),
        tap(() => this._isHydrating.set(false)),
        catchError(() => {
          this._isHydrating.set(false);
          return of(this.rankIds(query));
        }),
      ),
    );
  }

  // Un-hydrated (or stale) conversations with a usable keypair, newest first,
  // bounded to one batch (spec §9.2).
  private hydrationCandidates(): Conversation[] {
    return sortConversationsByUpdated(
      this._conversations.allConversations().filter((conversation) => {
        if (!conversation.keyPair) return false;
        const cached = this._cache.get(conversation.record.id);
        return cached?.cacheKey !== searchCacheKey(conversation.record);
      }),
    ).slice(0, SEARCH_HYDRATION_BATCH);
  }

  private hydrate$(conversation: Conversation): Observable<void> {
    const id = conversation.record.id;
    const cacheKey = searchCacheKey(conversation.record);
    return this._api.listConversationMessages(id, 1, 100).pipe(
      map((response) => {
        // response.items arrive newest-first (backend sorts created desc).
        const messages = response.items
          .map((record) =>
            decryptMessageData(record, conversation.keyPair, (bytes, keyPair) =>
              this._crypto.openSealedBox(bytes, keyPair),
            ),
          )
          .filter((data): data is NonNullable<typeof data> => data !== null)
          .map((data) => ({ content: data.content, deleted: data.deleted }));

        const recentMessages = buildRecentMessages(messages);
        this._cache.set(id, { recentMessages, cacheKey });
        if (this._db) {
          upsertSearchDocument(
            this._db,
            toSearchDocument(conversation, recentMessages),
          );
          this._indexedIds.add(id);
        }
      }),
      catchError(() => of(void 0)), // skip on fetch/decrypt error; index nothing
    );
  }
}
