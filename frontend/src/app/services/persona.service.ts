import { Injectable, Signal, computed, inject, signal } from '@angular/core';

import { Observable, catchError, map, of, switchMap, tap } from 'rxjs';

import { Base64 } from 'js-base64';

import {
  EncryptedPersonaData,
  Persona,
  PersonaColor,
  PersonaIcon,
  coercePersonaColor,
  coercePersonaIcon,
  defaultPersonaId,
  parsePersonaData,
  serializePersonaData,
} from '@app/interfaces/persona';
import { providedPersonas } from '@app/personas/provided-personas';
import { PersonasResponse } from '@app/types/pocketbase-types';

import { CognosApiService } from './cognos-api.service';
import { CryptoService } from './crypto.service';
import { ErrorService } from './error.service';
import { UserPreferencesService } from './user-preferences.service';
import { VaultService } from './vault.service';

const fallbackPersona =
  providedPersonas.find((persona) => persona.id === defaultPersonaId) ??
  providedPersonas[0];

export interface PersonaInput {
  name: string;
  description: string;
  systemPrompt: string;
  icon: PersonaIcon;
  color: PersonaColor;
}

export interface PersonaGroup {
  id: 'pinned' | 'recent' | 'official' | 'mine';
  label: string;
  personas: Persona[];
}

@Injectable({
  providedIn: 'root',
})
export class PersonaService {
  private readonly _api = inject(CognosApiService);
  private readonly _cryptoService = inject(CryptoService);
  private readonly _vaultService = inject(VaultService);
  private readonly _errorService = inject(ErrorService);
  private readonly _preferences = inject(UserPreferencesService);

  private readonly _customPersonas = signal<Persona[]>([]);
  private readonly _selectedPersonaId = signal<string | undefined>(undefined);

  readonly personaList = computed(() => [
    ...providedPersonas,
    ...this._customPersonas(),
  ]);

  // The active persona falls back to the user's saved default, then the Cognos
  // default, so a freshly loaded session always has a valid persona.
  readonly defaultPersona = computed(() => {
    const saved = this._preferences.defaultPersonaId();
    return (
      this.personaList().find((persona) => persona.id === saved) ?? fallbackPersona
    );
  });

  readonly selectedPersona = computed(() => {
    const selectedId = this._selectedPersonaId();
    return (
      this.personaList().find((persona) => persona.id === selectedId) ??
      this.defaultPersona()
    );
  });

  readonly customPersonas = this._customPersonas.asReadonly();
  readonly officialPersonas = computed(() =>
    this.personaList().filter((persona) => persona.source === 'cognos'),
  );

  readonly pinnedPersonas = computed(() => {
    const pinned = this._preferences.pinnedPersonas();
    return pinned
      .map((id) => this.personaList().find((persona) => persona.id === id))
      .filter((persona): persona is Persona => persona !== undefined);
  });

  readonly recentPersonas = computed(() => {
    const recent = this._preferences.recentPersonas();
    const pinned = new Set(this._preferences.pinnedPersonas());
    return recent
      .filter((id) => !pinned.has(id))
      .map((id) => this.personaList().find((persona) => persona.id === id))
      .filter((persona): persona is Persona => persona !== undefined);
  });

  // The grouped view that backs the personas page. Sections are omitted when
  // empty so the page never renders a heading with nothing under it.
  readonly personaGroups = computed<PersonaGroup[]>(() => {
    // Pinning moves a persona into the Pinned section; recency is additive, so
    // a recently-used persona still appears under Official or My personas.
    const pinnedIds = new Set(this._preferences.pinnedPersonas());

    const groups: PersonaGroup[] = [
      { id: 'pinned', label: 'Pinned', personas: this.pinnedPersonas() },
      { id: 'recent', label: 'Recently used', personas: this.recentPersonas() },
      {
        id: 'official',
        label: 'Official',
        personas: this.officialPersonas().filter(
          (persona) => !pinnedIds.has(persona.id),
        ),
      },
      {
        id: 'mine',
        label: 'My personas',
        personas: this._customPersonas().filter(
          (persona) => !pinnedIds.has(persona.id),
        ),
      },
    ];

    return groups.filter((group) => group.personas.length > 0);
  });

  constructor() {
    this._vaultService.keyPair$
      .pipe(
        switchMap((keyPair) => {
          if (!keyPair) {
            this._customPersonas.set([]);
            return of([]);
          }
          return this.loadCustomPersonas();
        }),
      )
      .subscribe((personas) => this._customPersonas.set(personas));
  }

  selectPersona(id: string): void {
    const persona = this.personaList().find((candidate) => candidate.id === id);
    if (persona) {
      this._selectedPersonaId.set(id);
      this._preferences.markRecentPersona(id);
    }
  }

  getPersona(id: string | undefined): Signal<Persona | undefined> {
    if (!id) {
      return signal(undefined);
    }
    return computed(() => this.personaList().find((persona) => persona.id === id));
  }

  isPinned(id: string): boolean {
    return this._preferences.isPersonaPinned(id);
  }

  togglePin(id: string): void {
    if (this._preferences.isPersonaPinned(id)) {
      this._preferences.unpinPersona(id);
    } else {
      this._preferences.pinPersona(id);
    }
  }

  isDefault(id: string): boolean {
    return this.defaultPersona().id === id;
  }

  setDefault(id: string): void {
    this._preferences.setDefaultPersona(id);
  }

  // Returns the input populated from an existing persona, ready for the editor
  // when a user duplicates a (possibly official, read-only) persona.
  duplicateInput(persona: Persona): PersonaInput {
    return {
      name: `${persona.name} copy`,
      description: persona.description,
      systemPrompt: persona.systemPrompt,
      icon: persona.icon,
      color: persona.color,
    };
  }

  createPersona(input: PersonaInput): Observable<Persona> {
    const data = this.normalizedPersonaData(input);
    const encryptedData = this.encryptPersonaData(data);

    return this._api.createPersona({ data: Base64.fromUint8Array(encryptedData) }).pipe(
      map((record) => this.decryptPersonaRecord(record)),
      tap((persona) => {
        this._customPersonas.update((personas) => [...personas, persona]);
        this.selectPersona(persona.id);
      }),
      catchError((error) => {
        console.error('Failed to create persona');
        this._errorService.alert('Failed to save persona');
        throw error;
      }),
    );
  }

  updatePersona(persona: Persona): Observable<Persona> {
    if (!persona.recordId) {
      return of(persona);
    }

    const data = this.normalizedPersonaData(persona);
    const encryptedData = this.encryptPersonaData(data);

    return this._api
      .updatePersona(persona.recordId, { data: Base64.fromUint8Array(encryptedData) })
      .pipe(
        map((record) => this.decryptPersonaRecord(record)),
        tap((updatedPersona) => {
          this._customPersonas.update((personas) =>
            personas.map((candidate) =>
              candidate.recordId === updatedPersona.recordId
                ? updatedPersona
                : candidate,
            ),
          );
        }),
        catchError((error) => {
          console.error('Failed to update persona');
          this._errorService.alert('Failed to update persona');
          throw error;
        }),
      );
  }

  deletePersona(persona: Persona): Observable<void> {
    if (!persona.recordId) {
      return of(undefined);
    }

    return this._api.deletePersona(persona.recordId).pipe(
      tap(() => {
        this._customPersonas.update((personas) =>
          personas.filter((candidate) => candidate.recordId !== persona.recordId),
        );
        if (this._preferences.isPersonaPinned(persona.id)) {
          this._preferences.unpinPersona(persona.id);
        }
        if (this.selectedPersona().id === persona.id) {
          this.selectPersona(this.defaultPersona().id);
        }
      }),
      catchError((error) => {
        console.error('Failed to delete persona');
        this._errorService.alert('Failed to delete persona');
        throw error;
      }),
    );
  }

  // Client-side search across name, description, and prompt. Cognos never sees
  // custom persona plaintext, so filtering has to happen here.
  search(personas: Persona[], query: string): Persona[] {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) {
      return personas;
    }
    return personas.filter((persona) =>
      [persona.name, persona.description, persona.systemPrompt]
        .join('\n')
        .toLowerCase()
        .includes(trimmed),
    );
  }

  private loadCustomPersonas(): Observable<Persona[]> {
    return this._api.listPersonas().pipe(
      map((records) => records.map((record) => this.decryptPersonaRecord(record))),
      catchError(() => {
        console.error('Failed to load personas');
        this._errorService.alert('Failed to load personas');
        return of([]);
      }),
    );
  }

  private normalizedPersonaData(input: PersonaInput): EncryptedPersonaData {
    return {
      version: '1',
      name: input.name.trim(),
      description: input.description.trim(),
      system_prompt: input.systemPrompt.trim(),
      icon: coercePersonaIcon(input.icon),
      color: coercePersonaColor(input.color),
    };
  }

  private encryptPersonaData(data: EncryptedPersonaData): Uint8Array {
    const userKeyPair = this._vaultService.keyPair();
    if (!userKeyPair) {
      throw new Error('User key pair not found');
    }

    const sharedKey = this._cryptoService.sharedKey(
      userKeyPair.publicKey,
      userKeyPair.secretKey,
    );

    return this._cryptoService.box(serializePersonaData(data), sharedKey);
  }

  private decryptPersonaRecord(record: PersonasResponse): Persona {
    const userKeyPair = this._vaultService.keyPair();
    if (!userKeyPair) {
      throw new Error('User key pair not found');
    }

    const sharedKey = this._cryptoService.sharedKey(
      userKeyPair.publicKey,
      userKeyPair.secretKey,
    );
    const data = parsePersonaData(
      this._cryptoService.openBox(Base64.toUint8Array(record.data), sharedKey),
    );

    return Persona.parse({
      id: record.id,
      recordId: record.id,
      name: data.name,
      description: data.description,
      systemPrompt: data.system_prompt,
      icon: data.icon,
      color: data.color,
      authorId: record.user,
      source: 'user',
    });
  }
}
