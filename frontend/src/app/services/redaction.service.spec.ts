import { TestBed } from '@angular/core/testing';

import { Observable, of, throwError } from 'rxjs';

import { beforeEach, describe, expect, it } from 'vitest';

import { Conversation } from '@app/interfaces/conversation';

import { AuthService } from './auth.service';
import {
  ApiCreateRedactionEntriesResponse,
  ApiCreateRedactionKeyResponse,
  ApiListRedactionEntriesResponse,
  ApiRedactionEntry,
  ApiRedactionKeyResponse,
  CognosApiService,
} from './cognos-api.service';
import { CryptoService } from './crypto.service';
import { RedactionService } from './redaction.service';
import { VaultService } from './vault.service';

// A fake backend that stores what the service seals, so the decrypt path can be
// exercised end to end with real crypto.
class FakeApi {
  key: ApiRedactionKeyResponse | null = null;
  entries: ApiRedactionEntry[] = [];

  getRedactionKey(): Observable<ApiRedactionKeyResponse> {
    return this.key ? of(this.key) : throwError(() => ({ status: 404 }));
  }

  createRedactionKey(
    _id: string,
    req: { public_key: string; keys: { wrapped_secret_key: string }[] },
  ): Observable<ApiCreateRedactionKeyResponse> {
    this.key = {
      public_key: req.public_key,
      wrapped_secret_key: req.keys[0].wrapped_secret_key,
      key_version: 1,
    };
    return of({ key_version: 1 });
  }

  listRedactionEntries(): Observable<ApiListRedactionEntriesResponse> {
    return of({
      items: this.entries.map((e) => ({
        token: e.token,
        data: e.data,
        key_version: 1,
        source_kind: e.source_kind,
        source_id: e.source_id ?? '',
      })),
    });
  }

  createRedactionEntries(
    _id: string,
    req: { entries: ApiRedactionEntry[] },
  ): Observable<ApiCreateRedactionEntriesResponse> {
    this.entries.push(...req.entries);
    return of({ created: req.entries.map((e) => e.token) });
  }
}

const conversation = { record: { id: 'conv1' } } as Conversation;

describe('RedactionService', () => {
  let service: RedactionService;
  let api: FakeApi;

  beforeEach(() => {
    api = new FakeApi();
    const crypto = new CryptoService();
    const userKeyPair = crypto.newKeyPair();

    TestBed.configureTestingModule({
      providers: [
        RedactionService,
        CryptoService,
        { provide: CognosApiService, useValue: api },
        { provide: VaultService, useValue: { keyPair: () => userKeyPair } },
        { provide: AuthService, useValue: { user: () => ({ id: 'user1' }) } },
      ],
    });
    service = TestBed.inject(RedactionService);
  });

  it('detects sensitive values for preview without I/O', () => {
    const candidates = service.detect('mail me at jane@example.com');
    expect(candidates).toHaveLength(1);
    expect(candidates[0].type).toBe('email');
  });

  it('redacts outgoing text and keeps the original out of it', () => {
    const { redactedText, newEntries } = service.prepareRedaction(
      'conv1',
      'pay GB82 WEST 1234 5698 7654 32 now',
    );
    expect(redactedText).not.toContain('GB82');
    expect(redactedText).toMatch(/\[\[PII_IBAN_[A-Z0-9]+\]\]/);
    expect(newEntries).toHaveLength(1);
  });

  it('persists mappings then hydrates them for the owner', async () => {
    const { redactedText, newEntries } = service.prepareRedaction(
      'conv1',
      'email jane@example.com',
    );
    await new Promise<void>((resolve, reject) => {
      service.persist(conversation, newEntries).subscribe({
        next: () => resolve(),
        error: reject,
      });
    });

    expect(service.hydrate('conv1', redactedText)).toBe('email jane@example.com');
    // A redaction key was created and sealed.
    expect(api.key).not.toBeNull();
    expect(api.entries).toHaveLength(1);
  });

  it('round-trips through the decrypt path on load', async () => {
    const { redactedText, newEntries } = service.prepareRedaction(
      'conv1',
      'iban GB82 WEST 1234 5698 7654 32',
    );
    await firstValue(service.persist(conversation, newEntries));

    // loadConversation rebuilds the mapping purely from the stored ciphertext
    // (unwrap key → decrypt each sealed entry), overwriting in-memory state.
    await firstValue(service.loadConversation(conversation));
    expect(service.hydrate('conv1', redactedText)).toContain(
      'GB82 WEST 1234 5698 7654 32',
    );
  });

  it('treats a missing redaction key as an empty mapping on load', async () => {
    await firstValue(service.loadConversation(conversation));
    expect(service.hydrate('conv1', 'plain text')).toBe('plain text');
  });
});

function firstValue<T>(obs: Observable<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    obs.subscribe({ next: resolve, error: reject });
  });
}
