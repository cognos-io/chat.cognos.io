import { signal } from '@angular/core';
import { TestBed } from '@angular/core/testing';

import { of } from 'rxjs';
import { Subject } from 'rxjs';

import { Base64 } from 'js-base64';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { defaultPersonaId } from '@app/interfaces/persona';

import { CognosApiService } from './cognos-api.service';
import { CryptoService } from './crypto.service';
import { ErrorService } from './error.service';
import { PersonaService } from './persona.service';
import { UserPreferencesService } from './user-preferences.service';
import { VaultService } from './vault.service';

describe('PersonaService', () => {
  const keyPair = {
    publicKey: new Uint8Array([1, 2, 3]),
    secretKey: new Uint8Array([4, 5, 6]),
  };
  const sharedKey = new Uint8Array([7, 8, 9]);
  const ciphertext = new Uint8Array([10, 11, 12]);

  let service: PersonaService;
  let keyPair$: Subject<typeof keyPair | undefined>;
  let api: {
    listPersonas: ReturnType<typeof vi.fn>;
    createPersona: ReturnType<typeof vi.fn>;
    updatePersona: ReturnType<typeof vi.fn>;
    deletePersona: ReturnType<typeof vi.fn>;
  };
  let cryptoService: {
    sharedKey: ReturnType<typeof vi.fn>;
    box: ReturnType<typeof vi.fn>;
    openBox: ReturnType<typeof vi.fn>;
  };

  beforeEach(() => {
    keyPair$ = new Subject<typeof keyPair | undefined>();
    api = {
      listPersonas: vi.fn().mockReturnValue(of([])),
      createPersona: vi.fn().mockReturnValue(
        of({
          id: 'pers1',
          created: '',
          updated: '',
          collectionId: 'personas',
          collectionName: 'personas',
          data: Base64.fromUint8Array(ciphertext),
          user: 'user1',
        }),
      ),
      updatePersona: vi.fn(),
      deletePersona: vi.fn(),
    };
    cryptoService = {
      sharedKey: vi.fn().mockReturnValue(sharedKey),
      box: vi.fn().mockReturnValue(ciphertext),
      openBox: vi.fn().mockReturnValue(
        new TextEncoder().encode(
          JSON.stringify({
            version: '1',
            name: 'Custom persona',
            description: 'Private description',
            system_prompt: 'Private prompt',
          }),
        ),
      ),
    };

    TestBed.configureTestingModule({
      providers: [
        PersonaService,
        { provide: CognosApiService, useValue: api },
        { provide: CryptoService, useValue: cryptoService },
        { provide: ErrorService, useValue: { alert: vi.fn() } },
        {
          provide: VaultService,
          useValue: {
            keyPair: () => keyPair,
            keyPair$: keyPair$.asObservable(),
          },
        },
        {
          provide: UserPreferencesService,
          useValue: {
            pinnedPersonas: signal<string[]>([]),
            recentPersonas: signal<string[]>([]),
            defaultPersonaId: signal(''),
            isPersonaPinned: vi.fn().mockReturnValue(false),
            pinPersona: vi.fn(),
            unpinPersona: vi.fn(),
            setDefaultPersona: vi.fn(),
            markRecentPersona: vi.fn(),
          },
        },
      ],
    });
    service = TestBed.inject(PersonaService);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('defaults to the simple assistant persona on first load', () => {
    expect(service.selectedPersona().id).toBe(defaultPersonaId);
  });

  it('includes provided Cognos personas', () => {
    expect(service.personaList().map((persona) => persona.id)).toContain(
      'cognos:technical-partner',
    );
  });

  it('returns an undefined-signal for getPersona when no id is supplied', () => {
    expect(service.getPersona(undefined)()).toBeUndefined();
  });

  it('returns an undefined-signal for getPersona when the id is unknown', () => {
    expect(service.getPersona('cognos:not-real')()).toBeUndefined();
  });

  it('ignores selectPersona calls for ids that are not in the persona list', () => {
    service.selectPersona('cognos:not-real');

    expect(service.selectedPersona().id).toBe(defaultPersonaId);
  });

  it('encrypts custom persona data before saving it', () => {
    service
      .createPersona({
        name: 'Custom persona',
        description: 'Private description',
        systemPrompt: 'Private prompt',
        icon: 'pencil',
        color: 'teal',
      })
      .subscribe();

    expect(api.createPersona).toHaveBeenCalledWith({
      data: Base64.fromUint8Array(ciphertext),
    });
    const plaintext = new TextDecoder().decode(cryptoService.box.mock.calls[0][0]);
    expect(plaintext).toContain('Private prompt');
    expect(api.createPersona.mock.calls[0][0].data).not.toContain('Private prompt');
  });

  it('groups official personas for the personas page', () => {
    const official = service.personaGroups().find((group) => group.id === 'official');
    expect(official?.personas.map((persona) => persona.id)).toContain(defaultPersonaId);
  });

  it('filters personas by name, description, or prompt', () => {
    const results = service.search(service.personaList(), 'socratic');
    expect(results.map((persona) => persona.id)).toEqual(['cognos:socratic']);
  });

  it('pins an unpinned persona through the preferences service', () => {
    const prefs = TestBed.inject(UserPreferencesService);
    service.togglePin('cognos:direct');
    expect(prefs.pinPersona).toHaveBeenCalledWith('cognos:direct');
  });

  it('marks a persona recently used when it is selected', () => {
    const prefs = TestBed.inject(UserPreferencesService);
    service.selectPersona('cognos:editor');

    expect(prefs.markRecentPersona).toHaveBeenCalledWith('cognos:editor');
    expect(service.selectedPersona().id).toBe('cognos:editor');
  });

  it('loads and decrypts custom personas when the vault unlocks', () => {
    api.listPersonas.mockReturnValue(
      of([
        {
          id: 'pers1',
          created: '',
          updated: '',
          collectionId: 'personas',
          collectionName: 'personas',
          data: Base64.fromUint8Array(ciphertext),
          user: 'user1',
        },
      ]),
    );

    keyPair$.next(keyPair);

    expect(service.getPersona('pers1')()?.systemPrompt).toBe('Private prompt');
  });
});
