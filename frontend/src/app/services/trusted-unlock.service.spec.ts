import { TestBed } from '@angular/core/testing';

import { of, throwError } from 'rxjs';

import { CognosApiService } from './cognos-api.service';
import { TrustedUnlockService } from './trusted-unlock.service';

describe('TrustedUnlockService', () => {
  let service: TrustedUnlockService;
  let originalLocalStorage: Storage | undefined;

  const storageKey = 'cognos:vault-session:user-1';
  const api = {
    deleteVaultSession: vi.fn(),
    getVaultSession: vi.fn(),
    upsertVaultSession: vi.fn(),
  };

  beforeEach(() => {
    const store = new Map<string, string>();
    originalLocalStorage = globalThis.localStorage;
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      value: {
        get length() {
          return store.size;
        },
        clear: () => store.clear(),
        getItem: (key: string) => store.get(key) ?? null,
        key: (index: number) => Array.from(store.keys())[index] ?? null,
        removeItem: (key: string) => {
          store.delete(key);
        },
        setItem: (key: string, value: string) => {
          store.set(key, value);
        },
      } satisfies Storage,
    });

    api.deleteVaultSession.mockReset();
    api.getVaultSession.mockReset();
    api.upsertVaultSession.mockReset();
    api.deleteVaultSession.mockReturnValue(of(undefined));

    TestBed.configureTestingModule({
      providers: [TrustedUnlockService, { provide: CognosApiService, useValue: api }],
    });

    service = TestBed.inject(TrustedUnlockService);
  });

  afterEach(() => {
    if (originalLocalStorage) {
      Object.defineProperty(globalThis, 'localStorage', {
        configurable: true,
        value: originalLocalStorage,
      });
    } else {
      Reflect.deleteProperty(globalThis, 'localStorage');
    }
    TestBed.resetTestingModule();
  });

  it('stores an encrypted local blob after persisting the wrap key', async () => {
    api.upsertVaultSession.mockReturnValue(of(undefined));

    await service.setUnlockKey('user-1', new Uint8Array([1, 2, 3, 4]));

    expect(api.upsertVaultSession).toHaveBeenCalledTimes(1);
    const storedBlob = localStorage.getItem(storageKey);
    expect(storedBlob).not.toBeNull();
    expect(storedBlob).not.toContain('[1,2,3,4]');
  });

  it('restores the unlock key from the local blob and server wrap key', async () => {
    api.upsertVaultSession.mockReturnValue(of(undefined));
    const unlockKey = new Uint8Array([9, 8, 7, 6]);

    await service.setUnlockKey('user-1', unlockKey);

    const wrapKey = api.upsertVaultSession.mock.calls[0][0];
    api.getVaultSession.mockReturnValue(of({ wrapKey }));

    await expect(service.getUnlockKey('user-1')).resolves.toEqual(unlockKey);
  });

  it('clears the local blob when the wrap-key fetch fails', async () => {
    api.upsertVaultSession.mockReturnValue(of(undefined));
    await service.setUnlockKey('user-1', new Uint8Array([5, 4, 3, 2]));
    api.getVaultSession.mockReturnValue(throwError(() => new Error('offline')));

    await expect(service.getUnlockKey('user-1')).resolves.toBeNull();

    expect(localStorage.getItem(storageKey)).toBeNull();
  });

  it('removes all trusted-unlock blobs even when server deletion fails', async () => {
    localStorage.setItem(
      'cognos:vault-session:user-1',
      '{"nonce":"a","ciphertext":"b"}',
    );
    localStorage.setItem(
      'cognos:vault-session:user-2',
      '{"nonce":"a","ciphertext":"b"}',
    );
    localStorage.setItem('other-key', 'keep-me');
    api.deleteVaultSession.mockReturnValue(throwError(() => new Error('offline')));

    await service.clearAllUnlockKeys();

    expect(localStorage.getItem('cognos:vault-session:user-1')).toBeNull();
    expect(localStorage.getItem('cognos:vault-session:user-2')).toBeNull();
    expect(localStorage.getItem('other-key')).toBe('keep-me');
    expect(api.deleteVaultSession).toHaveBeenCalledTimes(1);
  });
});
