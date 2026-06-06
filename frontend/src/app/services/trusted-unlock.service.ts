import { Injectable } from '@angular/core';

const databaseName = 'cognos-trusted-device';
const databaseVersion = 1;
const storeName = 'trusted_unlock_keys';

@Injectable({
  providedIn: 'root',
})
export class TrustedUnlockService {
  async getUnlockKey(userId: string | undefined): Promise<Uint8Array | null> {
    await this.clearUnlockKey(userId);
    return null;
  }

  async setUnlockKey(userId: string | undefined, unlockKey: Uint8Array): Promise<void> {
    void unlockKey;
    await this.clearUnlockKey(userId);
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

  async clearAllUnlockKeys(): Promise<void> {
    const db = await this.openDatabase();
    if (!db) {
      return;
    }

    try {
      const transaction = db.transaction(storeName, 'readwrite');
      transaction.objectStore(storeName).clear();
      await this.transactionToPromise(transaction);
    } finally {
      db.close();
    }
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

  private async transactionToPromise(transaction: IDBTransaction): Promise<void> {
    return new Promise((resolve, reject) => {
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
      transaction.onabort = () => reject(transaction.error);
    });
  }
}
