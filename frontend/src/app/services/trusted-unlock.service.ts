import { Injectable, inject } from '@angular/core';

import { firstValueFrom } from 'rxjs';

import { Base64 } from 'js-base64';
import nacl from 'tweetnacl';

import { CognosApiService } from './cognos-api.service';

const storagePrefix = 'cognos:vault-session:';

/**
 * Persists the per-device unlock key under a split-key model: the unlock key
 * ciphertext lives in localStorage, the random wrap key lives server-side
 * bound to the authenticated user. Both halves are required to recover the
 * unlock key, so an XSS that scrapes browser storage cannot decrypt without
 * also making a monitorable authenticated API call, and a server-side delete
 * (logout, manual revoke) immediately renders the local blob useless.
 */
@Injectable({
  providedIn: 'root',
})
export class TrustedUnlockService {
  private readonly _api = inject(CognosApiService);

  async getUnlockKey(userId: string | undefined): Promise<Uint8Array | null> {
    if (!userId) {
      return null;
    }

    const blob = this.readBlob(userId);
    if (!blob) {
      return null;
    }

    let wrapKey: Uint8Array;
    try {
      const session = await firstValueFrom(this._api.getVaultSession());
      wrapKey = Base64.toUint8Array(session.wrapKey);
    } catch {
      this.clearBlob(userId);
      return null;
    }

    if (wrapKey.length !== nacl.secretbox.keyLength) {
      this.clearBlob(userId);
      return null;
    }

    try {
      const plaintext = nacl.secretbox.open(blob.ciphertext, blob.nonce, wrapKey);
      if (!plaintext) {
        this.clearBlob(userId);
        return null;
      }
      return plaintext;
    } catch {
      this.clearBlob(userId);
      return null;
    }
  }

  async setUnlockKey(userId: string | undefined, unlockKey: Uint8Array): Promise<void> {
    if (!userId) {
      return;
    }

    const wrapKey = nacl.randomBytes(nacl.secretbox.keyLength);
    const nonce = nacl.randomBytes(nacl.secretbox.nonceLength);
    const ciphertext = nacl.secretbox(unlockKey, nonce, wrapKey);

    try {
      await firstValueFrom(
        this._api.upsertVaultSession(Base64.fromUint8Array(wrapKey)),
      );
    } catch {
      this.clearBlob(userId);
      return;
    }

    this.writeBlob(userId, { nonce, ciphertext });
  }

  async clearUnlockKey(userId: string | undefined): Promise<void> {
    if (!userId) {
      return;
    }

    this.clearBlob(userId);

    try {
      await firstValueFrom(this._api.deleteVaultSession());
    } catch {
      // Without the wrap key the local blob cannot decrypt anyway.
    }
  }

  async clearAllUnlockKeys(): Promise<void> {
    if (typeof localStorage !== 'undefined') {
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key && key.startsWith(storagePrefix)) {
          localStorage.removeItem(key);
        }
      }
    }

    try {
      await firstValueFrom(this._api.deleteVaultSession());
    } catch {
      // best effort
    }
  }

  private storageKey(userId: string): string {
    return `${storagePrefix}${userId}`;
  }

  private readBlob(
    userId: string,
  ): { nonce: Uint8Array; ciphertext: Uint8Array } | null {
    if (typeof localStorage === 'undefined') {
      return null;
    }

    const raw = localStorage.getItem(this.storageKey(userId));
    if (!raw) {
      return null;
    }

    try {
      const parsed = JSON.parse(raw) as { nonce?: string; ciphertext?: string };
      if (!parsed.nonce || !parsed.ciphertext) {
        return null;
      }
      return {
        nonce: Base64.toUint8Array(parsed.nonce),
        ciphertext: Base64.toUint8Array(parsed.ciphertext),
      };
    } catch {
      return null;
    }
  }

  private writeBlob(
    userId: string,
    blob: { nonce: Uint8Array; ciphertext: Uint8Array },
  ): void {
    if (typeof localStorage === 'undefined') {
      return;
    }

    localStorage.setItem(
      this.storageKey(userId),
      JSON.stringify({
        nonce: Base64.fromUint8Array(blob.nonce),
        ciphertext: Base64.fromUint8Array(blob.ciphertext),
      }),
    );
  }

  private clearBlob(userId: string): void {
    if (typeof localStorage === 'undefined') {
      return;
    }
    localStorage.removeItem(this.storageKey(userId));
  }
}
