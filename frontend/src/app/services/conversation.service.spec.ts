import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';

import { NEVER, Observable, firstValueFrom, of } from 'rxjs';

import { Base64 } from 'js-base64';

import { AuthService } from './auth.service';
import { CognosApiService } from './cognos-api.service';
import { ConversationService } from './conversation.service';
import { CryptoService } from './crypto.service';
import { UserPreferencesService } from './user-preferences.service';
import { VaultService } from './vault.service';

describe('ConversationService', () => {
  let service: ConversationService;
  let api: {
    getConversationPublicKey: ReturnType<typeof vi.fn>;
    getConversationSecretKey: ReturnType<typeof vi.fn>;
  };
  let cryptoService: {
    equalBytes: ReturnType<typeof vi.fn>;
    mac: ReturnType<typeof vi.fn>;
    openBox: ReturnType<typeof vi.fn>;
    sharedKey: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    api = {
      getConversationPublicKey: vi.fn(),
      getConversationSecretKey: vi.fn(),
    };

    cryptoService = {
      equalBytes: vi.fn().mockReturnValue(true),
      mac: vi.fn().mockReturnValue(new Uint8Array([1, 2, 3])),
      openBox: vi.fn().mockReturnValue(new Uint8Array([4])),
      sharedKey: vi.fn().mockReturnValue(new Uint8Array([5])),
    };

    TestBed.configureTestingModule({
      providers: [
        ConversationService,
        {
          provide: CognosApiService,
          useValue: api,
        },
        {
          provide: CryptoService,
          useValue: cryptoService,
        },
        {
          provide: VaultService,
          useValue: {
            keyPair: signal({
              publicKey: new Uint8Array([7]),
              secretKey: new Uint8Array([8]),
            }),
            keyPair$: NEVER,
          },
        },
        {
          provide: AuthService,
          useValue: {
            logout$: NEVER,
          },
        },
        {
          provide: Router,
          useValue: {
            navigate: vi.fn(),
          },
        },
        {
          provide: UserPreferencesService,
          useValue: {
            isConversationPinned: () => false,
          },
        },
      ],
    });

    service = TestBed.inject(ConversationService);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('rejects conversation public keys without a signature', async () => {
    api.getConversationPublicKey.mockReturnValue(
      of({
        id: 'pub-1',
        public_key: Base64.fromUint8Array(new Uint8Array([1, 2, 3])),
        public_key_signature: '',
      }),
    );
    api.getConversationSecretKey.mockReturnValue(
      of({ secret_key: Base64.fromUint8Array(new Uint8Array([4, 5, 6])) }),
    );

    const fetchConversationKeyPair = (
      service as unknown as Record<
        'fetchConversationKeyPair',
        (conversationId: string) => Observable<unknown>
      >
    ).fetchConversationKeyPair;

    await expect(
      firstValueFrom(fetchConversationKeyPair.call(service, 'conv-1')),
    ).rejects.toThrow('Conversation public key signature missing');
    expect(api.getConversationSecretKey).not.toHaveBeenCalled();
  });

  it('derives a dedicated mac key for conversation public key signatures', () => {
    const derivedMACKey = new Uint8Array([9, 8, 7]);
    const signature = new Uint8Array([6, 5, 4]);
    const publicKey = new Uint8Array([1, 2, 3]);
    const userSecretKey = new Uint8Array([4, 5, 6]);

    cryptoService.mac.mockReset();
    cryptoService.mac.mockReturnValueOnce(derivedMACKey).mockReturnValueOnce(signature);

    const computeConversationPublicKeySignature = (
      service as unknown as Record<
        'computeConversationPublicKeySignature',
        (
          conversationId: string,
          publicKey: Uint8Array,
          userSecretKey: Uint8Array,
        ) => Uint8Array
      >
    ).computeConversationPublicKeySignature;

    expect(
      computeConversationPublicKeySignature.call(
        service,
        'conv-1',
        publicKey,
        userSecretKey,
      ),
    ).toEqual(signature);
    expect(cryptoService.mac).toHaveBeenNthCalledWith(
      1,
      new TextEncoder().encode('cognos:conv-key-mac:v1'),
      userSecretKey,
    );
    expect(cryptoService.mac).toHaveBeenNthCalledWith(
      2,
      new TextEncoder().encode(
        JSON.stringify([
          'conversation_public_key_v1',
          'conv-1',
          Base64.fromUint8Array(publicKey),
        ]),
      ),
      derivedMACKey,
    );
  });
});
