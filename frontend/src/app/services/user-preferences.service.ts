import { Injectable, inject } from '@angular/core';

import PocketBase from 'pocketbase';

import { Observable, Subject, from, map, take, tap } from 'rxjs';

import { Base64 } from 'js-base64';
import { signalSlice } from 'ngxtension/signal-slice';

import {
  UserPreferencesData,
  emptyPreferences,
  parseUserPreferencesData,
  serializeUserPreferencesData,
} from '@app/interfaces/user_preferences';
import { ignorePocketbase404 } from '@app/operators/ignore-404';

import { TypedPocketBase } from '../types/pocketbase-types';
import { AuthService } from './auth.service';
import { CryptoService } from './crypto.service';
import { VaultService } from './vault.service';

interface UserPreferencesState extends UserPreferencesData {}

const initialState: UserPreferencesState = emptyPreferences;

@Injectable({
  providedIn: 'root',
})
export class UserPreferencesService {
  private readonly _pb: TypedPocketBase = inject(PocketBase);
  private readonly _cryptoService = inject(CryptoService);
  private readonly _vaultService = inject(VaultService);
  private readonly _authService = inject(AuthService);

  private readonly _pbUserPreferencesCollection =
    this._pb.collection('user_preferences');

  private readonly _pinConversation = new Subject<string>();
  private readonly _unpinConversation = new Subject<string>();

  private state = signalSlice({
    initialState,
    sources: [
      // Load user preferences from the database
      this.fetchUserPreferences(),
      // Pin/unpin conversation
      // Local state management
      (state) =>
        this._pinConversation.pipe(
          map((conversationId) => {
            return {
              pinnedConversations: [...state().pinnedConversations, conversationId],
            };
          }),
          tap((partialState) => {
            this.saveUserPreferences({ ...state(), ...partialState })
              .pipe(take(1))
              .subscribe();
          }),
        ),
      (state) =>
        this._unpinConversation.pipe(
          map((conversationId) => {
            return {
              pinnedConversations: state().pinnedConversations.filter(
                (id) => id !== conversationId,
              ),
            };
          }),
          tap((partialState) => {
            this.saveUserPreferences({ ...state(), ...partialState })
              .pipe(take(1))
              .subscribe();
          }),
        ),
    ],
  });

  // sources
  public pinConversation = (conversationId: string) => {
    this._pinConversation.next(conversationId);
  };
  public unpinConversation = (conversationId: string) => {
    this._unpinConversation.next(conversationId);
  };

  private encryptUserPreferencesData(data: UserPreferencesData): Uint8Array {
    const userKeyPair = this._vaultService.keyPair();

    if (!userKeyPair) {
      throw new Error('User key pair not found');
    }

    const sharedKey = this._cryptoService.sharedKey(
      userKeyPair.publicKey,
      userKeyPair.secretKey,
    );

    return this._cryptoService.box(serializeUserPreferencesData(data), sharedKey);
  }

  private decryptUserPreferencesData(data: Uint8Array): UserPreferencesData {
    const userKeyPair = this._vaultService.keyPair();

    if (!userKeyPair) {
      throw new Error('User key pair not found');
    }

    const sharedKey = this._cryptoService.sharedKey(
      userKeyPair.publicKey,
      userKeyPair.secretKey,
    );

    return parseUserPreferencesData(this._cryptoService.openBox(data, sharedKey));
  }

  private fetchUserPreferences(): Observable<UserPreferencesData> {
    const filter = this._pb.filter('user={:user}', {
      user: this._authService.user()?.['id'],
    });

    return from(this._pbUserPreferencesCollection.getFirstListItem(filter)).pipe(
      ignorePocketbase404(),
      map((record) => {
        return this.decryptUserPreferencesData(Base64.toUint8Array(record.data));
      }),
    );
  }

  private saveUserPreferences(
    preferences: UserPreferencesData,
  ): Observable<UserPreferencesData> {
    const encryptedData = this.encryptUserPreferencesData(preferences);

    return from(
      this._pbUserPreferencesCollection.create({
        user: this._authService.user()?.['id'],
        data: Base64.fromUint8Array(encryptedData),
      }),
    ).pipe(
      map((record) => {
        return this.decryptUserPreferencesData(Base64.toUint8Array(record.data));
      }),
    );
  }

  public isConversationPinned(conversationId: string): boolean {
    return this.state().pinnedConversations.includes(conversationId);
  }
}
