import { Injectable, Signal, computed, inject, signal } from '@angular/core';

import { Observable, catchError, map, of, switchMap, tap } from 'rxjs';

import { Base64 } from 'js-base64';

import {
  EncryptedPersonaData,
  Persona,
  defaultPersonaId,
  parsePersonaData,
  serializePersonaData,
} from '@app/interfaces/persona';
import { providedPersonas } from '@app/personas/provided-personas';
import { PersonasResponse } from '@app/types/pocketbase-types';

import { CognosApiService } from './cognos-api.service';
import { CryptoService } from './crypto.service';
import { ErrorService } from './error.service';
import { VaultService } from './vault.service';

const defaultPersona =
  providedPersonas.find((persona) => persona.id === defaultPersonaId) ??
  providedPersonas[0];

@Injectable({
  providedIn: 'root',
})
export class PersonaService {
  private readonly _api = inject(CognosApiService);
  private readonly _cryptoService = inject(CryptoService);
  private readonly _vaultService = inject(VaultService);
  private readonly _errorService = inject(ErrorService);

  private readonly _customPersonas = signal<Persona[]>([]);
  private readonly _selectedPersonaId = signal(defaultPersona.id);

  readonly personaList = computed(() => [
    ...providedPersonas,
    ...this._customPersonas(),
  ]);
  readonly selectedPersona = computed(() => {
    return (
      this.personaList().find((persona) => persona.id === this._selectedPersonaId()) ??
      defaultPersona
    );
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
    }
  }

  getPersona(id: string | undefined): Signal<Persona | undefined> {
    if (!id) {
      return signal(undefined);
    }
    return computed(() => this.personaList().find((persona) => persona.id === id));
  }

  createPersona(input: {
    name: string;
    description: string;
    systemPrompt: string;
  }): Observable<Persona> {
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
        if (this.selectedPersona().id === persona.id) {
          this.selectPersona(defaultPersona.id);
        }
      }),
      catchError((error) => {
        console.error('Failed to delete persona');
        this._errorService.alert('Failed to delete persona');
        throw error;
      }),
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

  private normalizedPersonaData(input: {
    name: string;
    description: string;
    systemPrompt: string;
  }): EncryptedPersonaData {
    return {
      version: '1',
      name: input.name.trim(),
      description: input.description.trim(),
      system_prompt: input.systemPrompt.trim(),
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
      authorId: record.user,
      source: 'user',
    });
  }
}
