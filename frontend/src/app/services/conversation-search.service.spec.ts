import { ApplicationRef, WritableSignal, signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { BehaviorSubject, of } from 'rxjs';

import { Base64 } from 'js-base64';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { Conversation } from '@app/interfaces/conversation';
import { KeyPair } from '@app/interfaces/key-pair';

import { MessageListResponse } from './cognos-api.service';
import { CognosApiService } from './cognos-api.service';
import {
  CONVERSATION_SEARCH_STEMMER_LOADER,
  ConversationSearchService,
} from './conversation-search.service';
import { ConversationService } from './conversation.service';
import { CryptoService } from './crypto.service';
import { LanguageService } from './language.service';
import { ProjectConversationService } from './project-conversation.service';
import { VaultService } from './vault.service';

const keyPair: KeyPair = {
  publicKey: new Uint8Array([1]),
  secretKey: new Uint8Array([2]),
};

const conv = (
  id: string,
  title: string,
  options: { activity?: string; project?: string } = {},
): Conversation => ({
  record: {
    id,
    created: '2026-01-01 00:00:00.000Z',
    updated: '2026-01-01 00:00:00.000Z',
    last_activity_at: options.activity ?? '2026-01-01 00:00:00.000Z',
    data: '',
    project: options.project,
  },
  decryptedData: { title },
  keyPair,
});

const messageResponse = (conversationId: string): MessageListResponse => ({
  page: 1,
  perPage: 100,
  totalItems: 1,
  totalPages: 1,
  items: [
    {
      id: 'm1',
      created: '2026-01-01 00:00:00.000Z',
      updated: '2026-01-01 00:00:00.000Z',
      data: Base64.fromUint8Array(new Uint8Array([0])),
      conversation: conversationId,
    },
  ],
});

const tick = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

describe('ConversationSearchService', () => {
  let conversations: WritableSignal<Conversation[]>;
  let language: WritableSignal<string>;
  let keyPair$: BehaviorSubject<KeyPair | undefined>;
  let listMessages: ReturnType<typeof vi.fn>;
  let openSealedBox: ReturnType<typeof vi.fn>;
  let service: ConversationSearchService;

  // Drives the messages decryptor: returns a payload whose conversation_id
  // matches the requested conversation (so binding checks pass).
  const decryptsTo = (conversationId: string, content: string): void => {
    openSealedBox.mockReturnValue(
      new TextEncoder().encode(
        JSON.stringify({ content, conversation_id: conversationId }),
      ),
    );
  };

  const flushIndex = async (): Promise<void> => {
    // Flush toObservable() effects so the index-build pipeline emits, then pass
    // its 50ms coalescing debounce.
    TestBed.inject(ApplicationRef).tick();
    await tick(80);
  };

  // Push a query and wait out the 400ms search debounce + hydration.
  const runQuery = async (value: string): Promise<void> => {
    service.setQuery(value);
    await tick(460);
  };

  beforeEach(() => {
    conversations = signal<Conversation[]>([]);
    language = signal('en');
    keyPair$ = new BehaviorSubject<KeyPair | undefined>(keyPair);
    listMessages = vi.fn((id: string) => of(messageResponse(id)));
    openSealedBox = vi.fn();

    TestBed.configureTestingModule({
      providers: [
        ConversationSearchService,
        { provide: VaultService, useValue: { keyPair$ } },
        { provide: ConversationService, useValue: { allConversations: conversations } },
        { provide: LanguageService, useValue: { current: language } },
        {
          provide: CognosApiService,
          useValue: { listConversationMessages: listMessages },
        },
        { provide: CryptoService, useValue: { openSealedBox } },
        { provide: ProjectConversationService, useValue: {} },
        // Deterministic: skip the dynamic stemmer import (language-neutral).
        {
          provide: CONVERSATION_SEARCH_STEMMER_LOADER,
          useValue: async () => undefined,
        },
      ],
    });

    service = TestBed.inject(ConversationSearchService);
  });

  it('matches a conversation by title from the title-only index', async () => {
    // No message decryption configured: the title index alone must find it.
    openSealedBox.mockReturnValue(
      new TextEncoder().encode(JSON.stringify({ content: '' })),
    );
    conversations.set([conv('c1', 'Lease agreement'), conv('c2', 'Holiday plans')]);
    await flushIndex();

    await runQuery('lease');

    expect(service.isActive()).toBe(true);
    expect(service.results().map((c) => c.record.id)).toEqual(['c1']);
  });

  it('finds a conversation by recent message content after hydration', async () => {
    conversations.set([conv('c1', 'Catch up')]);
    await flushIndex();
    decryptsTo('c1', 'about the mortgage rate');

    await runQuery('mortgage');

    expect(listMessages).toHaveBeenCalledWith('c1', 1, 100);
    expect(service.results().map((c) => c.record.id)).toEqual(['c1']);
  });

  it('does not search or hydrate for queries under 3 characters', async () => {
    conversations.set([conv('c1', 'Lease agreement')]);
    await flushIndex();

    await runQuery('le');

    expect(service.isActive()).toBe(false);
    expect(service.results()).toEqual([]);
    expect(listMessages).not.toHaveBeenCalled();
  });

  it('reuses hydrated message text while activity is unchanged', async () => {
    conversations.set([conv('c1', 'Catch up')]);
    await flushIndex();
    decryptsTo('c1', 'about the mortgage rate');

    await runQuery('mortgage');
    expect(listMessages).toHaveBeenCalledTimes(1);

    // Clear, then search again — the cache is still valid, so no refetch.
    await runQuery('x');
    await runQuery('mortgage');
    expect(listMessages).toHaveBeenCalledTimes(1);
    expect(service.results().map((c) => c.record.id)).toEqual(['c1']);
  });

  it('re-hydrates when a conversation’s activity timestamp changes', async () => {
    conversations.set([
      conv('c1', 'Catch up', { activity: '2026-01-01 00:00:00.000Z' }),
    ]);
    await flushIndex();
    decryptsTo('c1', 'about the mortgage rate');

    await runQuery('mortgage');
    expect(listMessages).toHaveBeenCalledTimes(1);

    // New activity → cache key changes → stale text dropped → refetch.
    conversations.set([
      conv('c1', 'Catch up', { activity: '2026-02-02 00:00:00.000Z' }),
    ]);
    await flushIndex();
    await runQuery('y');
    await runQuery('mortgage');
    expect(listMessages).toHaveBeenCalledTimes(2);
  });

  it('does not index content when decryption fails', async () => {
    conversations.set([conv('c1', 'Catch up')]);
    await flushIndex();
    openSealedBox.mockImplementation(() => {
      throw new Error('bad keypair');
    });

    await runQuery('mortgage');

    expect(listMessages).toHaveBeenCalled();
    expect(service.results()).toEqual([]); // fallback string never indexed
  });

  it('clears the index and results when the vault locks', async () => {
    conversations.set([conv('c1', 'Lease agreement')]);
    await flushIndex();
    await runQuery('lease');
    expect(service.results().length).toBe(1);

    keyPair$.next(undefined); // lock / logout
    await flushIndex();

    expect(service.query()).toBe('');
    expect(service.results()).toEqual([]);
  });
});
