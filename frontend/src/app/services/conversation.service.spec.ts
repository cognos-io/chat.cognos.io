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

  const callFetchConversationKeyPair = (
    conversationId: string,
  ): Observable<unknown> => {
    const fetchConversationKeyPair = (
      service as unknown as Record<
        'fetchConversationKeyPair',
        (conversationId: string) => Observable<unknown>
      >
    ).fetchConversationKeyPair;
    return fetchConversationKeyPair.call(service, conversationId);
  };

  const callResolveConversationKeyPair = (
    record: Record<string, unknown>,
  ): Observable<unknown> => {
    const resolveConversationKeyPair = (
      service as unknown as Record<
        'resolveConversationKeyPair',
        (record: Record<string, unknown>) => Observable<unknown>
      >
    ).resolveConversationKeyPair;
    return resolveConversationKeyPair.call(service, record);
  };

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

    await expect(
      firstValueFrom(callFetchConversationKeyPair('conv-1')),
    ).rejects.toThrow('Conversation public key signature missing');
    expect(api.getConversationSecretKey).not.toHaveBeenCalled();
  });

  it('rejects conversation public keys whose signature does not match', async () => {
    api.getConversationPublicKey.mockReturnValue(
      of({
        id: 'pub-1',
        public_key: Base64.fromUint8Array(new Uint8Array([1, 2, 3])),
        public_key_signature: Base64.fromUint8Array(new Uint8Array([9, 9, 9])),
      }),
    );
    api.getConversationSecretKey.mockReturnValue(
      of({ secret_key: Base64.fromUint8Array(new Uint8Array([4, 5, 6])) }),
    );
    cryptoService.equalBytes.mockReturnValue(false);

    await expect(
      firstValueFrom(callFetchConversationKeyPair('conv-1')),
    ).rejects.toThrow('Conversation public key signature mismatch');
    expect(api.getConversationSecretKey).not.toHaveBeenCalled();
  });

  it('decrypts the conversation secret key on a verified signature', async () => {
    const publicKeyBytes = new Uint8Array([1, 2, 3]);
    const signatureBytes = new Uint8Array([6, 5, 4]);
    const encryptedSecretBytes = new Uint8Array([10, 20, 30]);
    const sharedKey = new Uint8Array([42]);
    const decryptedSecret = new Uint8Array([99, 100, 101]);

    api.getConversationPublicKey.mockReturnValue(
      of({
        id: 'pub-1',
        public_key: Base64.fromUint8Array(publicKeyBytes),
        public_key_signature: Base64.fromUint8Array(signatureBytes),
      }),
    );
    api.getConversationSecretKey.mockReturnValue(
      of({ secret_key: Base64.fromUint8Array(encryptedSecretBytes) }),
    );
    cryptoService.equalBytes.mockReturnValue(true);
    cryptoService.sharedKey.mockReturnValue(sharedKey);
    cryptoService.openBox.mockReturnValue(decryptedSecret);

    const result = (await firstValueFrom(callFetchConversationKeyPair('conv-1'))) as {
      publicKey: Uint8Array;
      secretKey: Uint8Array;
    };

    expect(Array.from(result.publicKey)).toEqual(Array.from(publicKeyBytes));
    expect(Array.from(result.secretKey)).toEqual(Array.from(decryptedSecret));
    // The shared key for unwrapping the conversation secret key is derived from
    // the *conversation* public key + the *user* secret key, not from the user
    // key pair alone. Pin both arguments so a regression in the arg order is
    // caught loudly.
    expect(cryptoService.sharedKey).toHaveBeenCalledWith(
      publicKeyBytes,
      new Uint8Array([8]),
    );
    const openBoxArgs = cryptoService.openBox.mock.calls.at(-1) as [
      Uint8Array,
      Uint8Array,
    ];
    expect(Array.from(openBoxArgs[0])).toEqual(Array.from(encryptedSecretBytes));
    expect(Array.from(openBoxArgs[1])).toEqual(Array.from(sharedKey));
  });

  it('decrypts from embedded list key material without per-conversation requests', async () => {
    const publicKeyBytes = new Uint8Array([1, 2, 3]);
    const signatureBytes = new Uint8Array([6, 5, 4]);
    const wrappedSecretBytes = new Uint8Array([10, 20, 30]);
    const sharedKey = new Uint8Array([42]);
    const decryptedSecret = new Uint8Array([99, 100, 101]);

    cryptoService.equalBytes.mockReturnValue(true);
    cryptoService.sharedKey.mockReturnValue(sharedKey);
    cryptoService.openBox.mockReturnValue(decryptedSecret);

    const result = (await firstValueFrom(
      callResolveConversationKeyPair({
        id: 'conv-embed',
        data: '',
        public_key: Base64.fromUint8Array(publicKeyBytes),
        public_key_signature: Base64.fromUint8Array(signatureBytes),
        wrapped_secret_key: Base64.fromUint8Array(wrappedSecretBytes),
      }),
    )) as { publicKey: Uint8Array; secretKey: Uint8Array };

    expect(Array.from(result.publicKey)).toEqual(Array.from(publicKeyBytes));
    expect(Array.from(result.secretKey)).toEqual(Array.from(decryptedSecret));
    // The whole point of embedding: no key round-trips on the happy path.
    expect(api.getConversationPublicKey).not.toHaveBeenCalled();
    expect(api.getConversationSecretKey).not.toHaveBeenCalled();

    const openBoxArgs = cryptoService.openBox.mock.calls.at(-1) as [
      Uint8Array,
      Uint8Array,
    ];
    expect(Array.from(openBoxArgs[0])).toEqual(Array.from(wrappedSecretBytes));
    expect(Array.from(openBoxArgs[1])).toEqual(Array.from(sharedKey));
  });

  it('falls back to per-conversation key endpoints when embedded keys are absent', async () => {
    api.getConversationPublicKey.mockReturnValue(
      of({
        id: 'pub-1',
        public_key: Base64.fromUint8Array(new Uint8Array([1, 2, 3])),
        public_key_signature: Base64.fromUint8Array(new Uint8Array([6, 5, 4])),
      }),
    );
    api.getConversationSecretKey.mockReturnValue(
      of({ secret_key: Base64.fromUint8Array(new Uint8Array([10, 20, 30])) }),
    );
    cryptoService.equalBytes.mockReturnValue(true);

    await firstValueFrom(
      callResolveConversationKeyPair({ id: 'conv-nokeys', data: '' }),
    );

    expect(api.getConversationPublicKey).toHaveBeenCalledWith('conv-nokeys');
    expect(api.getConversationSecretKey).toHaveBeenCalledWith('conv-nokeys');
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
