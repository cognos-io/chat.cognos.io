import { Injectable } from '@angular/core';

import { Base64 } from 'js-base64';

interface TrustedUnlockRecord {
  iv?: string;
  unlockKey?: string;
  userId: string;
  wrappedUnlockKey?: string;
  wrappingKey?: CryptoKey;
}

const databaseName = 'cognos-trusted-device';
const databaseVersion = 1;
const storeName = 'trusted_unlock_keys';
const wrappingKeyAlgorithm = {
  length: 256,
  name: 'AES-GCM',
} as const;
const wrappingNonceBytes = 12;

@Injectable({
  providedIn: 'root',
})
export class TrustedUnlockService {
  async getUnlockKey(userId: string | undefined): Promise<Uint8Array | null> {
    if (!userId) {
      return null;
    }

    const db = await this.openDatabase();
    if (!db) {
      return null;
    }

    try {
      const transaction = db.transaction(storeName, 'readonly');
      const request = transaction.objectStore(storeName).get(userId);
      const record = (await this.requestToPromise(request)) as
        | TrustedUnlockRecord
        | undefined;

      if (!record) {
        return null;
      }

      if (record.unlockKey) {
        await this.clearUnlockKey(userId);
        return null;
      }

      if (!record.iv || !record.wrappedUnlockKey || !record.wrappingKey) {
        await this.clearUnlockKey(userId);
        return null;
      }

      const cryptoApi = this.getCrypto();
      if (!cryptoApi) {
        return null;
      }

      const plaintext = await cryptoApi.subtle.decrypt(
        {
          iv: new Uint8Array(Base64.toUint8Array(record.iv)),
          name: wrappingKeyAlgorithm.name,
        },
        record.wrappingKey,
        new Uint8Array(Base64.toUint8Array(record.wrappedUnlockKey)),
      );

      return new Uint8Array(plaintext);
    } catch {
      await this.clearUnlockKey(userId);
      return null;
    } finally {
      db.close();
    }
  }

  async setUnlockKey(userId: string | undefined, unlockKey: Uint8Array): Promise<void> {
    if (!userId) {
      return;
    }

    const db = await this.openDatabase();
    const cryptoApi = this.getCrypto();
    if (!db || !cryptoApi) {
      return;
    }

    try {
      const wrappingKey = await cryptoApi.subtle.generateKey(
        wrappingKeyAlgorithm,
        false,
        ['encrypt', 'decrypt'],
      );
      const iv = cryptoApi.getRandomValues(new Uint8Array(wrappingNonceBytes));
      const wrappedUnlockKey = await cryptoApi.subtle.encrypt(
        {
          iv,
          name: wrappingKeyAlgorithm.name,
        },
        wrappingKey,
        new Uint8Array(unlockKey),
      );

      const transaction = db.transaction(storeName, 'readwrite');
      transaction.objectStore(storeName).put({
        iv: Base64.fromUint8Array(iv),
        userId,
        wrappedUnlockKey: Base64.fromUint8Array(new Uint8Array(wrappedUnlockKey)),
        wrappingKey,
      });
      await this.transactionToPromise(transaction);
    } finally {
      db.close();
    }
  }

  async clearUnlockKey(userId: string | undefined): Promise<void> {
    if (!userId) {
      return;
    }

    const db = await this.openDatabase();
    if (!db) {
      return;
    }

    try {
      const transaction = db.transaction(storeName, 'readwrite');
      transaction.objectStore(storeName).delete(userId);
      await this.transactionToPromise(transaction);
    } finally {
      db.close();
    }
  }

  private getCrypto(): Crypto | null {
    if (typeof globalThis.crypto === 'undefined' || !globalThis.crypto.subtle) {
      return null;
    }

    return globalThis.crypto;
  }

  private async openDatabase(): Promise<IDBDatabase | null> {
    if (typeof indexedDB === 'undefined') {
      return null;
    }

    return new Promise((resolve, reject) => {
      const request = indexedDB.open(databaseName, databaseVersion);

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db.objectStoreNames.contains(storeName)) {
          db.createObjectStore(storeName, { keyPath: 'userId' });
        }
      };

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  private async requestToPromise(request: IDBRequest): Promise<unknown> {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  private async transactionToPromise(transaction: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }
}
