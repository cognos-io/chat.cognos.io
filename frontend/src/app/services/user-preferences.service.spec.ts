import { TestBed } from '@angular/core/testing';

import { Subject, of, throwError } from 'rxjs';

import { Base64 } from 'js-base64';

import {
  parseUserPreferencesData,
  serializeUserPreferencesData,
} from '@app/interfaces/user_preferences';

import { CognosApiService } from './cognos-api.service';
import { CryptoService } from './crypto.service';
import { ErrorService } from './error.service';
import { UserPreferencesService } from './user-preferences.service';
import { VaultService } from './vault.service';

describe('UserPreferencesService', () => {
  let service: UserPreferencesService;
  let currentKeyPair:
    | {
        publicKey: Uint8Array;
        secretKey: Uint8Array;
      }
    | undefined;

  const keyPair$ = new Subject<typeof currentKeyPair>();

  const api = {
    createUserPreferences: vi.fn(),
    getUserPreferences: vi.fn(),
    updateUserPreferences: vi.fn(),
  };

  const cryptoService = {
    box: vi.fn((data: Uint8Array) => data),
    openBox: vi.fn((data: Uint8Array) => data),
    sharedKey: vi.fn(() => new Uint8Array([1, 2, 3])),
  };

  const errorService = {
    alert: vi.fn(),
  };

  const emitKeyPair = (value: typeof currentKeyPair) => {
    currentKeyPair = value;
    keyPair$.next(value);
  };

  const decodePreferences = (payload: { data: string }) =>
    parseUserPreferencesData(Base64.toUint8Array(payload.data));

  const flushPromises = async () => {
    await Promise.resolve();
    await Promise.resolve();
  };

  beforeEach(() => {
    currentKeyPair = {
      publicKey: new Uint8Array([1, 2, 3]),
      secretKey: new Uint8Array([4, 5, 6]),
    };
    api.createUserPreferences.mockReset();
    api.getUserPreferences.mockReset();
    api.updateUserPreferences.mockReset();
    cryptoService.box.mockClear();
    cryptoService.openBox.mockClear();
    cryptoService.sharedKey.mockClear();
    errorService.alert.mockReset();

    TestBed.configureTestingModule({
      providers: [
        UserPreferencesService,
        { provide: CognosApiService, useValue: api },
        { provide: CryptoService, useValue: cryptoService },
        { provide: ErrorService, useValue: errorService },
        {
          provide: VaultService,
          useValue: {
            keyPair: () => currentKeyPair,
            keyPair$,
          },
        },
      ],
    });

    service = TestBed.inject(UserPreferencesService);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('hydrates pinned preferences after the key pair becomes available', async () => {
    api.getUserPreferences.mockReturnValue(
      of({
        id: 'prefs-1',
        data: Base64.fromUint8Array(
          serializeUserPreferencesData({
            pinnedConversations: ['conv-1'],
            pinnedModels: ['model-1'],
          }),
        ),
      }),
    );

    emitKeyPair(currentKeyPair);
    await flushPromises();

    expect(api.getUserPreferences).toHaveBeenCalledTimes(1);
    expect(service.isConversationPinned('conv-1')).toBe(true);
    expect(service.isModelPinned('model-1')).toBe(true);
  });

  it('pins a conversation without duplicating it in persisted preferences', async () => {
    api.getUserPreferences.mockReturnValue(throwError(() => ({ status: 404 })));
    api.createUserPreferences.mockImplementation((payload: { data: string }) =>
      of({ id: 'prefs-1', data: payload.data }),
    );
    api.updateUserPreferences.mockImplementation(
      (_recordId: string, payload: { data: string }) =>
        of({ id: 'prefs-1', data: payload.data }),
    );

    emitKeyPair(currentKeyPair);
    await flushPromises();

    service.pinConversation('conv-1');
    await flushPromises();
    service.pinConversation('conv-1');
    await flushPromises();

    expect(service.isConversationPinned('conv-1')).toBe(true);
    expect(api.createUserPreferences).toHaveBeenCalledTimes(1);
    expect(api.updateUserPreferences).toHaveBeenCalledTimes(1);
    expect(
      decodePreferences(api.updateUserPreferences.mock.calls[0][1]).pinnedConversations,
    ).toEqual(['conv-1']);
  });

  it('unpinned conversations are removed from the persisted payload', async () => {
    api.getUserPreferences.mockReturnValue(
      of({
        id: 'prefs-1',
        data: Base64.fromUint8Array(
          serializeUserPreferencesData({
            pinnedConversations: ['conv-1', 'conv-2'],
            pinnedModels: [],
          }),
        ),
      }),
    );
    api.updateUserPreferences.mockImplementation(
      (_recordId: string, payload: { data: string }) =>
        of({ id: 'prefs-1', data: payload.data }),
    );

    emitKeyPair(currentKeyPair);
    await flushPromises();
    service.unpinConversation('conv-1');
    await flushPromises();

    expect(service.isConversationPinned('conv-1')).toBe(false);
    expect(service.isConversationPinned('conv-2')).toBe(true);
    expect(api.updateUserPreferences).toHaveBeenCalledWith('prefs-1', {
      data: expect.any(String),
    });
    expect(
      decodePreferences(api.updateUserPreferences.mock.calls[0][1]).pinnedConversations,
    ).toEqual(['conv-2']);
  });

  it('persists a pinned persona without duplicating it', async () => {
    api.getUserPreferences.mockReturnValue(throwError(() => ({ status: 404 })));
    api.createUserPreferences.mockImplementation((payload: { data: string }) =>
      of({ id: 'prefs-1', data: payload.data }),
    );
    api.updateUserPreferences.mockImplementation(
      (_recordId: string, payload: { data: string }) =>
        of({ id: 'prefs-1', data: payload.data }),
    );

    emitKeyPair(currentKeyPair);
    await flushPromises();
    service.pinPersona('cognos:direct');
    await flushPromises();
    service.pinPersona('cognos:direct');
    await flushPromises();

    expect(service.isPersonaPinned('cognos:direct')).toBe(true);
    expect(
      decodePreferences(api.updateUserPreferences.mock.calls.at(-1)![1]).pinnedPersonas,
    ).toEqual(['cognos:direct']);
  });

  it('keeps recently used personas most-recent-first, de-duplicated and capped', async () => {
    api.getUserPreferences.mockReturnValue(throwError(() => ({ status: 404 })));
    api.createUserPreferences.mockImplementation((payload: { data: string }) =>
      of({ id: 'prefs-1', data: payload.data }),
    );
    api.updateUserPreferences.mockImplementation(
      (_recordId: string, payload: { data: string }) =>
        of({ id: 'prefs-1', data: payload.data }),
    );

    emitKeyPair(currentKeyPair);
    await flushPromises();

    for (const id of ['a', 'b', 'a', 'c', 'd', 'e', 'f', 'g', 'h', 'i']) {
      service.markRecentPersona(id);
      await flushPromises();
    }

    const recent = service.recentPersonas();
    expect(recent[0]).toBe('i');
    expect(recent.length).toBe(8);
    expect(new Set(recent).size).toBe(recent.length);
  });

  it('hides, unhides and resets hidden models, persisting each change', async () => {
    // Start from an existing record so every mutation is an update (the first
    // mutation on a fresh user would otherwise create the record).
    api.getUserPreferences.mockReturnValue(
      of({
        id: 'prefs-1',
        data: Base64.fromUint8Array(
          serializeUserPreferencesData({ pinnedConversations: [], hiddenModels: [] }),
        ),
      }),
    );
    api.updateUserPreferences.mockImplementation(
      (_recordId: string, payload: { data: string }) =>
        of({ id: 'prefs-1', data: payload.data }),
    );

    emitKeyPair(currentKeyPair);
    await flushPromises();

    service.hideModel('model-x');
    await flushPromises();
    expect(service.isModelHidden('model-x')).toBe(true);
    expect(
      decodePreferences(api.updateUserPreferences.mock.calls.at(-1)![1]).hiddenModels,
    ).toEqual(['model-x']);

    service.unhideModel('model-x');
    await flushPromises();
    expect(service.isModelHidden('model-x')).toBe(false);
    expect(
      decodePreferences(api.updateUserPreferences.mock.calls.at(-1)![1]).hiddenModels,
    ).toEqual([]);

    service.hideModel('model-y');
    await flushPromises();
    service.resetHiddenModels();
    await flushPromises();
    expect(service.hiddenModels()).toEqual([]);
    expect(
      decodePreferences(api.updateUserPreferences.mock.calls.at(-1)![1]).hiddenModels,
    ).toEqual([]);
  });

  it('keeps recently used models most-recent-first, de-duplicated and capped', async () => {
    api.getUserPreferences.mockReturnValue(throwError(() => ({ status: 404 })));
    api.createUserPreferences.mockImplementation((payload: { data: string }) =>
      of({ id: 'prefs-1', data: payload.data }),
    );
    api.updateUserPreferences.mockImplementation(
      (_recordId: string, payload: { data: string }) =>
        of({ id: 'prefs-1', data: payload.data }),
    );

    emitKeyPair(currentKeyPair);
    await flushPromises();

    for (const id of ['a', 'b', 'a', 'c', 'd', 'e', 'f', 'g', 'h', 'i']) {
      service.markRecentModel(id);
      await flushPromises();
    }

    const recent = service.recentModels();
    expect(recent[0]).toBe('i');
    expect(recent.length).toBe(8);
    expect(new Set(recent).size).toBe(recent.length);
  });
});
