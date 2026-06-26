import { Injectable, inject, signal } from '@angular/core';

import { Observable, map, of } from 'rxjs';

import { Base64 } from 'js-base64';

import {
  CompactionDurableMemory,
  ScopedMemory,
  ScopedMemoryPayload,
} from '@app/interfaces/compaction';

import { ApiMemoryRecord, CognosApiService } from './cognos-api.service';
import { CryptoService } from './crypto.service';
import { ProjectService } from './project.service';
import { VaultService } from './vault.service';

const emptyDurableMemory = (): CompactionDurableMemory => ({
  items: [],
});

const buildPayload = (
  scope: 'user' | 'project',
  durableMemory: CompactionDurableMemory,
): ScopedMemoryPayload => ({
  version: '1',
  kind: 'scoped_memory',
  scope,
  durable_memory: durableMemory,
  created_at: '',
});

/**
 * ScopedMemoryService manages user- and project-scoped memory: client-encrypted
 * records that follow the user across chats / a project across its conversations
 * (spec §16). User memory is sealed to the user's vault key; project memory is
 * encrypted with the project content key. One record per scope; "add" appends a
 * fact, creating the record on first use. The server only stores ciphertext.
 */
@Injectable({ providedIn: 'root' })
export class ScopedMemoryService {
  private readonly _api = inject(CognosApiService);
  private readonly _crypto = inject(CryptoService);
  private readonly _vault = inject(VaultService);
  private readonly _projects = inject(ProjectService);

  private readonly _userMemory = signal<ScopedMemory | null>(null);
  private readonly _projectMemory = signal<Map<string, ScopedMemory | null>>(new Map());

  /** userMemory returns the cached decrypted user memory, if loaded. */
  userMemory(): ScopedMemory | null {
    return this._userMemory();
  }

  /** projectMemoryFor returns the cached decrypted memory for a project. */
  projectMemoryFor(projectId: string): ScopedMemory | null {
    return this._projectMemory().get(projectId) ?? null;
  }

  /** loadUserMemory fetches and decrypts the user's memory into the cache. */
  loadUserMemory(): Observable<ScopedMemory | null> {
    const keyPair = this._vault.keyPair();
    if (!keyPair) {
      return of(null);
    }
    return this._api.listUserMemory().pipe(
      map((records) => {
        const memory = this.decryptNewest(records, (data) =>
          this._crypto.openSealedBox(Base64.toUint8Array(data), keyPair),
        );
        this._userMemory.set(memory);
        return memory;
      }),
    );
  }

  /** loadProjectMemory fetches and decrypts a project's memory into the cache. */
  loadProjectMemory(projectId: string): Observable<ScopedMemory | null> {
    const contentKey = this.projectContentKey(projectId);
    if (!contentKey) {
      return of(null);
    }
    return this._api.listProjectMemory(projectId).pipe(
      map((records) => {
        const memory = this.decryptNewest(records, (data) =>
          this._crypto.openSecretBox(Base64.toUint8Array(data), contentKey),
        );
        this.cacheProject(projectId, memory);
        return memory;
      }),
    );
  }

  /** addUserFact appends a snippet to the user's memory (creating it if needed). */
  addUserFact(fact: string): Observable<ScopedMemory | null> {
    const keyPair = this._vault.keyPair();
    if (!keyPair) {
      return of(null);
    }
    const existing = this._userMemory();
    const durableMemory = this.appendFact(existing, fact);
    if (!durableMemory) {
      return of(existing);
    }
    const data = this.sealUser(buildPayload('user', durableMemory), keyPair.publicKey);
    const request = existing
      ? this._api.updateUserMemory(existing.recordId, data)
      : this._api.createUserMemory(data);
    return request.pipe(
      map((record) => {
        const memory = this.toMemory(record, 'user', durableMemory);
        this._userMemory.set(memory);
        return memory;
      }),
    );
  }

  /**
   * saveUserMemory replaces the user's whole memory (facts/decisions/open
   * threads/glossary), creating the record on first save. Used by the settings
   * memory editor. The caller re-redacts any edited text first.
   */
  saveUserMemory(
    durableMemory: CompactionDurableMemory,
  ): Observable<ScopedMemory | null> {
    const keyPair = this._vault.keyPair();
    if (!keyPair) {
      return of(null);
    }
    const existing = this._userMemory();
    const data = this.sealUser(buildPayload('user', durableMemory), keyPair.publicKey);
    const request = existing
      ? this._api.updateUserMemory(existing.recordId, data)
      : this._api.createUserMemory(data);
    return request.pipe(
      map((record) => {
        const memory = this.toMemory(record, 'user', durableMemory);
        this._userMemory.set(memory);
        return memory;
      }),
    );
  }

  /** addProjectFact appends a snippet to a project's memory. */
  addProjectFact(projectId: string, fact: string): Observable<ScopedMemory | null> {
    const contentKey = this.projectContentKey(projectId);
    if (!contentKey) {
      return of(null);
    }
    const existing = this.projectMemoryFor(projectId);
    const durableMemory = this.appendFact(existing, fact);
    if (!durableMemory) {
      return of(existing);
    }
    const data = Base64.fromUint8Array(
      this._crypto.secretBox(
        this.encode(buildPayload('project', durableMemory)),
        contentKey,
      ),
    );
    const request = existing
      ? this._api.updateProjectMemory(existing.recordId, data)
      : this._api.createProjectMemory(projectId, data);
    return request.pipe(
      map((record) => {
        const memory = this.toMemory(record, 'project', durableMemory);
        this.cacheProject(projectId, memory);
        return memory;
      }),
    );
  }

  // appendFact returns the new durable memory with `fact` added, or null when it
  // is already present (no write needed).
  private appendFact(
    existing: ScopedMemory | null,
    fact: string,
  ): CompactionDurableMemory | null {
    const base = existing?.payload.durable_memory ?? emptyDurableMemory();
    if (base.items.includes(fact)) {
      return null;
    }
    return { ...base, items: [...base.items, fact] };
  }

  private decryptNewest(
    records: ApiMemoryRecord[],
    open: (data: string) => Uint8Array | null,
  ): ScopedMemory | null {
    // Newest record wins (the canonical one); others are stale duplicates.
    const sorted = [...records].sort((a, b) => b.created.localeCompare(a.created));
    for (const record of sorted) {
      const memory = this.tryDecrypt(record, open);
      if (memory) {
        return memory;
      }
    }
    return null;
  }

  private tryDecrypt(
    record: ApiMemoryRecord,
    open: (data: string) => Uint8Array | null,
  ): ScopedMemory | null {
    try {
      const plaintext = open(record.data);
      if (!plaintext) {
        return null;
      }
      const payload = ScopedMemoryPayload.parse(
        JSON.parse(new TextDecoder().decode(plaintext)),
      );
      return { recordId: record.id, payload };
    } catch (error) {
      console.error('Scoped memory decryption failed', error);
      return null;
    }
  }

  private sealUser(payload: ScopedMemoryPayload, publicKey: Uint8Array): string {
    return Base64.fromUint8Array(
      this._crypto.createSealedBox(this.encode(payload), publicKey),
    );
  }

  private encode(payload: ScopedMemoryPayload): Uint8Array {
    return new TextEncoder().encode(JSON.stringify(payload));
  }

  private toMemory(
    record: ApiMemoryRecord,
    scope: 'user' | 'project',
    durableMemory: CompactionDurableMemory,
  ): ScopedMemory {
    return { recordId: record.id, payload: buildPayload(scope, durableMemory) };
  }

  private projectContentKey(projectId: string): Uint8Array | null {
    return (
      this._projects.projects().find((p) => p.record.id === projectId)?.contentKey ??
      null
    );
  }

  private cacheProject(projectId: string, memory: ScopedMemory | null): void {
    const next = new Map(this._projectMemory());
    next.set(projectId, memory);
    this._projectMemory.set(next);
  }
}
