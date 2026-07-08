import { Injectable, computed, inject, signal } from '@angular/core';

import { Observable, map, of } from 'rxjs';

import { Base64 } from 'js-base64';

import { BookmarkAnchor } from '@app/components/chat/bookmark-highlight/bookmark-anchor';
import { Bookmark, BookmarkPayload } from '@app/interfaces/bookmark';

import { ApiBookmarkRecord, CognosApiService } from './cognos-api.service';
import { CryptoService } from './crypto.service';
import { VaultService } from './vault.service';

/**
 * BookmarkService manages the user's highlighted spans (bookmarks): the quote
 * and its surrounding context are chat content, so the whole payload is sealed
 * CLIENT-SIDE to the user's vault public key and stored as opaque ciphertext
 * (spec: zero-knowledge). The server only ever sees base64 plus the plaintext
 * conversation/message links used to re-anchor the highlight and jump back.
 *
 * The cache is keyed by record id; mirrors ScopedMemoryService's
 * decrypt-with-try/catch style (undecryptable records are skipped, never thrown
 * into the UI).
 */
@Injectable({ providedIn: 'root' })
export class BookmarkService {
  private readonly _api = inject(CognosApiService);
  private readonly _crypto = inject(CryptoService);
  private readonly _vault = inject(VaultService);

  private readonly _bookmarks = signal<Map<string, Bookmark>>(new Map());

  /** All bookmarks, newest first. */
  readonly all = computed(() =>
    [...this._bookmarks().values()].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    ),
  );

  /** Bookmarks for a conversation, newest first. */
  forConversation(conversationId: string): Bookmark[] {
    return this.all().filter((b) => b.conversationId === conversationId);
  }

  /** Bookmarks anchored to a single message, newest first. */
  forMessage(messageId: string): Bookmark[] {
    return this.all().filter((b) => b.messageId === messageId);
  }

  /** loadAll fetches and decrypts every bookmark, replacing the whole cache. */
  loadAll(): Observable<Bookmark[]> {
    const keyPair = this._vault.keyPair();
    if (!keyPair) {
      return of([]);
    }
    return this._api.listBookmarks().pipe(
      map((records) => {
        const decrypted = this.decryptAll(records);
        this._bookmarks.set(new Map(decrypted.map((b) => [b.recordId, b])));
        return decrypted;
      }),
    );
  }

  /**
   * loadForConversation fetches and decrypts a conversation's bookmarks,
   * replacing just that conversation's entries in the cache (others untouched).
   */
  loadForConversation(conversationId: string): Observable<Bookmark[]> {
    const keyPair = this._vault.keyPair();
    if (!keyPair) {
      return of([]);
    }
    return this._api.listBookmarks(conversationId).pipe(
      map((records) => {
        const decrypted = this.decryptAll(records);
        const next = new Map(this._bookmarks());
        for (const [id, b] of next) {
          if (b.conversationId === conversationId) {
            next.delete(id);
          }
        }
        for (const b of decrypted) {
          next.set(b.recordId, b);
        }
        this._bookmarks.set(next);
        return decrypted;
      }),
    );
  }

  /**
   * create seals a BookmarkPayload to the vault public key, stores it, and adds
   * the decrypted bookmark to the cache. Resolves to null when the vault is
   * locked (no key pair).
   */
  create(
    conversationId: string,
    messageId: string,
    anchor: BookmarkAnchor,
    note?: string,
  ): Observable<Bookmark | null> {
    const keyPair = this._vault.keyPair();
    if (!keyPair) {
      return of(null);
    }
    const payload: BookmarkPayload = {
      version: '1',
      kind: 'bookmark',
      quote: anchor.quote,
      prefix: anchor.prefix,
      suffix: anchor.suffix,
      ...(note ? { note } : {}),
      created_at: new Date().toISOString(),
    };
    const data = this.seal(payload, keyPair.publicKey);
    return this._api
      .createBookmark({ conversation: conversationId, message: messageId, data })
      .pipe(
        map((record) => {
          const bookmark: Bookmark = {
            recordId: record.id,
            conversationId,
            messageId,
            quote: payload.quote,
            prefix: payload.prefix,
            suffix: payload.suffix,
            note: payload.note,
            createdAt: payload.created_at,
          };
          const next = new Map(this._bookmarks());
          next.set(bookmark.recordId, bookmark);
          this._bookmarks.set(next);
          return bookmark;
        }),
      );
  }

  /** remove deletes a bookmark (server record + cache entry). */
  remove(recordId: string): Observable<void> {
    return this._api.deleteBookmark(recordId).pipe(
      map(() => {
        const next = new Map(this._bookmarks());
        next.delete(recordId);
        this._bookmarks.set(next);
        return void 0;
      }),
    );
  }

  private decryptAll(records: ApiBookmarkRecord[]): Bookmark[] {
    const out: Bookmark[] = [];
    for (const record of records) {
      const bookmark = this.tryDecrypt(record);
      if (bookmark) {
        out.push(bookmark);
      }
    }
    return out;
  }

  private tryDecrypt(record: ApiBookmarkRecord): Bookmark | null {
    const keyPair = this._vault.keyPair();
    if (!keyPair) {
      return null;
    }
    try {
      const plaintext = this._crypto.openSealedBox(
        Base64.toUint8Array(record.data),
        keyPair,
      );
      if (!plaintext) {
        return null;
      }
      const payload = BookmarkPayload.parse(
        JSON.parse(new TextDecoder().decode(plaintext)),
      );
      return {
        recordId: record.id,
        conversationId: record.conversation,
        messageId: record.message,
        quote: payload.quote,
        prefix: payload.prefix,
        suffix: payload.suffix,
        note: payload.note,
        createdAt: payload.created_at,
      };
    } catch (error) {
      console.error('Bookmark decryption failed', error);
      return null;
    }
  }

  private seal(payload: BookmarkPayload, publicKey: Uint8Array): string {
    return Base64.fromUint8Array(
      this._crypto.createSealedBox(
        new TextEncoder().encode(JSON.stringify(payload)),
        publicKey,
      ),
    );
  }
}
