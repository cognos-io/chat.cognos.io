import { TestBed } from '@angular/core/testing';

import { of } from 'rxjs';

import { Base64 } from 'js-base64';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BookmarkAnchor } from '@app/components/chat/bookmark-highlight/bookmark-anchor';
import { BookmarkPayload } from '@app/interfaces/bookmark';
import { KeyPair } from '@app/interfaces/key-pair';

import { BookmarkService } from './bookmark.service';
import { ApiBookmarkRecord, CognosApiService } from './cognos-api.service';
import { CryptoService } from './crypto.service';
import { VaultService } from './vault.service';

const keyPair: KeyPair = {
  publicKey: new Uint8Array([1]),
  secretKey: new Uint8Array([2]),
};

// A stored record whose ciphertext base64 is the JSON payload itself — the
// mocked openSealedBox just base64-decodes it back, so decryption is
// deterministic without real crypto.
const record = (
  id: string,
  conversation: string,
  message: string,
  payload: Partial<BookmarkPayload> & { quote: string; created_at: string },
): ApiBookmarkRecord => {
  const full: BookmarkPayload = {
    version: '1',
    kind: 'bookmark',
    prefix: '',
    suffix: '',
    ...payload,
  };
  return {
    id,
    conversation,
    message,
    data: Base64.fromUint8Array(new TextEncoder().encode(JSON.stringify(full))),
    created: payload.created_at,
    updated: payload.created_at,
  };
};

describe('BookmarkService', () => {
  let listBookmarks: ReturnType<typeof vi.fn>;
  let createBookmark: ReturnType<typeof vi.fn>;
  let deleteBookmark: ReturnType<typeof vi.fn>;
  let openSealedBox: ReturnType<typeof vi.fn>;
  let createSealedBox: ReturnType<typeof vi.fn>;
  let vaultKeyPair: KeyPair | undefined;
  let service: BookmarkService;

  beforeEach(() => {
    vaultKeyPair = keyPair;
    listBookmarks = vi.fn(() => of([]));
    createBookmark = vi.fn();
    deleteBookmark = vi.fn(() => of(void 0));
    // Round-trips the base64 the record helper produced.
    openSealedBox = vi.fn((data: Uint8Array) => data);
    createSealedBox = vi.fn((msg: Uint8Array) => msg);

    TestBed.configureTestingModule({
      providers: [
        BookmarkService,
        {
          provide: CognosApiService,
          useValue: { listBookmarks, createBookmark, deleteBookmark },
        },
        { provide: CryptoService, useValue: { openSealedBox, createSealedBox } },
        { provide: VaultService, useValue: { keyPair: () => vaultKeyPair } },
      ],
    });

    service = TestBed.inject(BookmarkService);
  });

  it('seals a payload and caches the created bookmark', () => {
    createBookmark.mockReturnValue(
      of({
        id: 'b1',
        conversation: 'c1',
        message: 'm1',
        data: '',
        created: '',
        updated: '',
      }),
    );
    const anchor: BookmarkAnchor = {
      quote: 'hello world',
      prefix: 'say ',
      suffix: ' now',
    };

    let result: unknown;
    service.create('c1', 'm1', anchor, 'a note').subscribe((b) => (result = b));

    // The sealed payload carries the anchor + note + kind/version.
    expect(createSealedBox).toHaveBeenCalledTimes(1);
    const sealed = JSON.parse(
      new TextDecoder().decode(createSealedBox.mock.calls[0][0] as Uint8Array),
    );
    expect(sealed).toMatchObject({
      version: '1',
      kind: 'bookmark',
      quote: 'hello world',
      prefix: 'say ',
      suffix: ' now',
      note: 'a note',
    });
    expect(typeof sealed.created_at).toBe('string');

    expect(createBookmark).toHaveBeenCalledWith({
      conversation: 'c1',
      message: 'm1',
      data: expect.any(String),
    });
    expect(result).toMatchObject({ recordId: 'b1', quote: 'hello world' });
    expect(service.all().map((b) => b.recordId)).toEqual(['b1']);
    expect(service.forMessage('m1')).toHaveLength(1);
  });

  it('returns null and does not call the API when the vault is locked', () => {
    vaultKeyPair = undefined;
    let result: unknown = 'unset';
    service
      .create('c1', 'm1', { quote: 'q', prefix: '', suffix: '' })
      .subscribe((b) => (result = b));

    expect(result).toBeNull();
    expect(createBookmark).not.toHaveBeenCalled();
  });

  it('loadForConversation decrypts and scopes to that conversation', () => {
    listBookmarks.mockReturnValue(
      of([
        record('b1', 'c1', 'm1', {
          quote: 'first',
          created_at: '2026-01-01T00:00:00Z',
        }),
        record('b2', 'c1', 'm2', {
          quote: 'second',
          created_at: '2026-01-02T00:00:00Z',
        }),
      ]),
    );

    service.loadForConversation('c1').subscribe();

    expect(listBookmarks).toHaveBeenCalledWith('c1');
    // Newest-first ordering.
    expect(service.all().map((b) => b.quote)).toEqual(['second', 'first']);
    expect(service.forConversation('c1')).toHaveLength(2);
    expect(service.forConversation('c2')).toHaveLength(0);
  });

  it('replaces only the reloaded conversation, keeping others cached', () => {
    listBookmarks.mockReturnValueOnce(
      of([
        record('b1', 'c1', 'm1', { quote: 'c1a', created_at: '2026-01-01T00:00:00Z' }),
      ]),
    );
    service.loadForConversation('c1').subscribe();

    listBookmarks.mockReturnValueOnce(
      of([
        record('b2', 'c2', 'm9', { quote: 'c2a', created_at: '2026-01-03T00:00:00Z' }),
      ]),
    );
    service.loadForConversation('c2').subscribe();

    expect(
      service
        .all()
        .map((b) => b.recordId)
        .sort(),
    ).toEqual(['b1', 'b2']);

    // Reloading c1 with an empty list drops its entries but not c2's.
    listBookmarks.mockReturnValueOnce(of([]));
    service.loadForConversation('c1').subscribe();
    expect(service.all().map((b) => b.recordId)).toEqual(['b2']);
  });

  it('skips undecryptable records', () => {
    openSealedBox.mockImplementation(() => {
      throw new Error('bad key');
    });
    listBookmarks.mockReturnValue(
      of([
        record('b1', 'c1', 'm1', { quote: 'x', created_at: '2026-01-01T00:00:00Z' }),
      ]),
    );

    service.loadAll().subscribe();

    expect(service.all()).toEqual([]);
  });

  it('remove deletes the record and drops it from the cache', () => {
    listBookmarks.mockReturnValue(
      of([
        record('b1', 'c1', 'm1', { quote: 'x', created_at: '2026-01-01T00:00:00Z' }),
      ]),
    );
    service.loadAll().subscribe();
    expect(service.all()).toHaveLength(1);

    service.remove('b1').subscribe();

    expect(deleteBookmark).toHaveBeenCalledWith('b1');
    expect(service.all()).toEqual([]);
  });
});
