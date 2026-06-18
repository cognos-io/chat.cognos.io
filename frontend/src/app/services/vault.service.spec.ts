import { TestBed } from '@angular/core/testing';

import { NEVER, Subject, of, throwError } from 'rxjs';

import { Base64 } from 'js-base64';

import { AuthService } from './auth.service';
import { CognosApiService } from './cognos-api.service';
import { CryptoService } from './crypto.service';
import { TrustedUnlockService } from './trusted-unlock.service';
import {
  UNLOCK_SCHEME_ACCOUNT_KEY,
  UNLOCK_SCHEME_PASSWORD_ACCOUNT_KEY,
  VaultService,
  buildUnlockSecretMaterial,
  normaliseAccountKey,
} from './vault.service';

describe('normaliseAccountKey', () => {
  it('strips separators and upper-cases so formatting never changes the key', () => {
    expect(normaliseAccountKey('abcd-ef12-3456')).toBe('ABCDEF123456');
    expect(normaliseAccountKey('ABCD EF12 3456')).toBe('ABCDEF123456');
    expect(normaliseAccountKey('abcdef123456')).toBe('ABCDEF123456');
  });
});

describe('buildUnlockSecretMaterial', () => {
  const decode = (bytes: Uint8Array) => new TextDecoder().decode(bytes);

  it('v2 derives from the Account Key alone and ignores the password', () => {
    const withPassword = buildUnlockSecretMaterial(
      UNLOCK_SCHEME_ACCOUNT_KEY,
      'ab-cd-ef',
      'hunter2',
    );
    const withoutPassword = buildUnlockSecretMaterial(
      UNLOCK_SCHEME_ACCOUNT_KEY,
      'ab-cd-ef',
      '',
    );
    const differentPassword = buildUnlockSecretMaterial(
      UNLOCK_SCHEME_ACCOUNT_KEY,
      'ab-cd-ef',
      'a-totally-different-password',
    );

    // The whole point of v2: the password is not part of the data key, so
    // changing or forgetting it never changes what the Account Key unlocks.
    expect(decode(withPassword)).toBe('ABCDEF');
    expect(withoutPassword).toEqual(withPassword);
    expect(differentPassword).toEqual(withPassword);
  });

  it('v1 (legacy) keeps the exact password + NUL + key format', () => {
    const material = buildUnlockSecretMaterial(
      UNLOCK_SCHEME_PASSWORD_ACCOUNT_KEY,
      'ab-cd-ef',
      'hunter2',
    );

    expect(decode(material)).toBe(`hunter2${String.fromCharCode(0)}ABCDEF`);
  });

  it('throws on an unknown scheme rather than deriving a wrong key', () => {
    expect(() => buildUnlockSecretMaterial('made_up_v9', 'ab-cd', 'pw')).toThrowError(
      /unsupported unlock scheme/,
    );
  });
});

describe('VaultService', () => {
  let service: VaultService;
  let cryptoService: {
    equalBytes: ReturnType<typeof vi.fn>;
    mac: ReturnType<typeof vi.fn>;
    openSecretBox: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    cryptoService = {
      equalBytes: vi.fn().mockReturnValue(true),
      mac: vi.fn().mockReturnValue(new Uint8Array([1, 2, 3])),
      openSecretBox: vi.fn().mockReturnValue(new Uint8Array([4, 5, 6])),
    };

    TestBed.configureTestingModule({
      providers: [
        VaultService,
        {
          provide: CognosApiService,
          useValue: {
            getUserKeyPair: () => NEVER,
          },
        },
        {
          provide: CryptoService,
          useValue: cryptoService,
        },
        {
          provide: AuthService,
          useValue: {
            logout$: NEVER,
            user$: NEVER,
            user: () => ({ id: 'user-1' }),
          },
        },
        {
          provide: TrustedUnlockService,
          useValue: {
            clearAllUnlockKeys: async () => {},
            clearUnlockKey: async () => {},
            getUnlockKey: async () => undefined,
            setUnlockKey: async () => {},
          },
        },
      ],
    });

    service = TestBed.inject(VaultService);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('rejects user key pair records without a record mac', () => {
    const keyPairRecord = {
      id: 'kp-1',
      user: 'user-1',
      public_key: Base64.fromUint8Array(new Uint8Array([1, 2, 3])),
      secret_key: Base64.fromUint8Array(new Uint8Array([4, 5, 6])),
      password_salt: Base64.fromUint8Array(new Uint8Array([7, 8, 9])),
      unlock_scheme: 'password_account_key_v1',
      record_mac: '',
    };

    expect(() =>
      service.unpackKeyPairRecord(keyPairRecord as never, new Uint8Array([9, 9, 9])),
    ).toThrowError('User key pair integrity metadata missing');
    expect(cryptoService.openSecretBox).not.toHaveBeenCalled();
  });

  it('rejects user key pair records when the record mac does not match', () => {
    cryptoService.mac.mockReturnValue(new Uint8Array([9, 9, 9]));
    cryptoService.equalBytes.mockReturnValue(false);

    const keyPairRecord = {
      id: 'kp-1',
      user: 'user-1',
      public_key: Base64.fromUint8Array(new Uint8Array([1, 2, 3])),
      secret_key: Base64.fromUint8Array(new Uint8Array([4, 5, 6])),
      password_salt: Base64.fromUint8Array(new Uint8Array([7, 8, 9])),
      unlock_scheme: 'password_account_key_v1',
      record_mac: Base64.fromUint8Array(new Uint8Array([1, 2, 3])),
    };

    expect(() =>
      service.unpackKeyPairRecord(keyPairRecord as never, new Uint8Array([9, 9, 9])),
    ).toThrowError('User key pair integrity check failed');
    expect(cryptoService.openSecretBox).not.toHaveBeenCalled();
  });
});

describe('VaultService rebinds to the authenticated user', () => {
  const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

  const setup = (getUserKeyPair: () => unknown) => {
    const user$ = new Subject<{ id: string } | null>();
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [
        VaultService,
        { provide: CognosApiService, useValue: { getUserKeyPair } },
        {
          provide: CryptoService,
          useValue: { equalBytes: vi.fn(), mac: vi.fn(), openSecretBox: vi.fn() },
        },
        {
          provide: AuthService,
          useValue: { logout$: NEVER, user$, user: () => null },
        },
        {
          provide: TrustedUnlockService,
          useValue: {
            clearAllUnlockKeys: async () => {},
            clearUnlockKey: async () => {},
            getUnlockKey: async () => undefined, // no trusted device → unlock/generate path
            setUnlockKey: async () => {},
          },
        },
      ],
    });
    const service = TestBed.inject(VaultService);
    const sub = service.keyPair$.subscribe(); // activate the merged state stream
    return { service, user$, sub };
  };

  afterEach(() => TestBed.resetTestingModule());

  // A brand-new account (no backup → 404) must land in the generate-key flow,
  // never the unlock-existing-backup flow.
  it('treats a 404 key-pair as a new key pair', async () => {
    const { service, user$, sub } = setup(() => throwError(() => ({ status: 404 })));

    user$.next({ id: 'new-user' });
    await flush();

    expect(service.isNewKeyPair()).toBe(true);
    sub.unsubscribe();
  });

  // Regression: switching identities must re-fetch and not inherit the previous
  // user's vault state (the singleton bug where a fresh signup saw someone
  // else's "unlock backup" prompt).
  it('re-fetches and resets when the user changes', async () => {
    const existingRecord = {
      id: 'kp-1',
      user: 'user-a',
      public_key: Base64.fromUint8Array(new Uint8Array([1, 2, 3])),
      secret_key: Base64.fromUint8Array(new Uint8Array([4, 5, 6])),
      password_salt: Base64.fromUint8Array(new Uint8Array([7, 8, 9])),
      unlock_scheme: 'password_account_key_v1',
      record_mac: Base64.fromUint8Array(new Uint8Array([1, 2, 3])),
    };
    let call = 0;
    const { service, user$, sub } = setup(() => {
      call += 1;
      return call === 1 ? of(existingRecord) : throwError(() => ({ status: 404 }));
    });

    // User A has an existing backup → unlock flow (not "new").
    user$.next({ id: 'user-a' });
    await flush();
    expect(service.isNewKeyPair()).toBe(false);

    // Sign out → state resets.
    user$.next(null);
    await flush();

    // User B has no backup (404) → must be "new", not inherit A's record.
    user$.next({ id: 'user-b' });
    await flush();
    expect(service.isNewKeyPair()).toBe(true);

    sub.unsubscribe();
  });
});

describe('VaultService logout hygiene', () => {
  afterEach(() => {
    TestBed.resetTestingModule();
    localStorage.clear();
  });

  // Security: logout must leave no vault state behind — the unlock keys/server
  // session go via TrustedUnlockService, and the trusted-user-key context
  // (salt / fingerprint / scheme) must be swept from localStorage too.
  it('clears unlock keys and every trusted-user-key context on logout', async () => {
    const logout$ = new Subject<boolean>();
    const clearAllUnlockKeys = vi.fn().mockResolvedValue(undefined);

    localStorage.setItem(
      'cognos:trusted-user-key:user-1',
      JSON.stringify({ passwordSalt: 'salt' }),
    );
    localStorage.setItem('cognos:trusted-user-key:user-2', '{}');
    localStorage.setItem('unrelated-key', 'keep-me');

    TestBed.configureTestingModule({
      providers: [
        VaultService,
        { provide: CognosApiService, useValue: { getUserKeyPair: () => NEVER } },
        {
          provide: CryptoService,
          useValue: { equalBytes: vi.fn(), mac: vi.fn(), openSecretBox: vi.fn() },
        },
        {
          provide: AuthService,
          useValue: { logout$, user$: NEVER, user: () => ({ id: 'user-1' }) },
        },
        {
          provide: TrustedUnlockService,
          useValue: {
            clearAllUnlockKeys,
            clearUnlockKey: async () => {},
            getUnlockKey: async () => undefined,
            setUnlockKey: async () => {},
          },
        },
      ],
    });

    const service = TestBed.inject(VaultService);
    const sub = service.keyPair$.subscribe(); // activate the merged state stream

    logout$.next(true);
    await new Promise((resolve) => setTimeout(resolve, 0)); // flush clearAllUnlockKeys

    expect(clearAllUnlockKeys).toHaveBeenCalledOnce();
    expect(localStorage.getItem('cognos:trusted-user-key:user-1')).toBeNull();
    expect(localStorage.getItem('cognos:trusted-user-key:user-2')).toBeNull();
    // Non-vault keys are untouched.
    expect(localStorage.getItem('unrelated-key')).toBe('keep-me');

    sub.unsubscribe();
  });
});
