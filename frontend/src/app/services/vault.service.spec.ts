import { TestBed } from '@angular/core/testing';

import { NEVER } from 'rxjs';

import { Base64 } from 'js-base64';

import { AuthService } from './auth.service';
import { CognosApiService } from './cognos-api.service';
import { CryptoService } from './crypto.service';
import { TrustedUnlockService } from './trusted-unlock.service';
import { VaultService } from './vault.service';

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
