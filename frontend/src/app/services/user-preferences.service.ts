import { Injectable, inject } from '@angular/core';

import PocketBase from 'pocketbase';

import { EMPTY, Observable, Subject, catchError, from, map, switchMap } from 'rxjs';

import { Base64 } from 'js-base64';
import { signalSlice } from 'ngxtension/signal-slice';

import {
  UserPreferencesData,
  emptyPreferences,
  parseUserPreferencesData,
  serializeUserPreferencesData,
} from '@app/interfaces/user_preferences';
import { ignorePocketbase404 } from '@app/operators/ignore-404';

import { TypedPocketBase, UserPreferencesResponse } from '../types/pocketbase-types';
import { AuthService } from './auth.service';
import { CryptoService } from './crypto.service';
import { ErrorService } from './error.service';
import { VaultService } from './vault.service';

interface UserPreferencesState extends UserPreferencesData {
  // null means the record does not exist, undefined we haven't loaded it yet
  recordId: string | undefined;
}

const initialState: UserPreferencesState = { ...emptyPreferences, recordId: undefined };

@Injectable({
  providedIn: 'root',
})
export class UserPreferencesService {
  private readonly _pb: TypedPocketBase = inject(PocketBase);
  private readonly _cryptoService = inject(CryptoService);
  private readonly _vaultService = inject(VaultService);
  private readonly _errorService = inject(ErrorService);
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
      // Pin conversation, local state
      (state) =>
        this._pinConversation.pipe(
          map((conversationId) => {
            return {
              pinnedConversations: this.addConversationIdToPinnedConversations(
                conversationId,
                state().pinnedConversations,
              ),
            };
          }),
        ),
      // Unpin conversation, local state
      (state) =>
        this._unpinConversation.pipe(
          map((conversationId) => {
            return {
              pinnedConversations: state().pinnedConversations.filter(
                (id) => id !== conversationId,
              ),
            };
          }),
        ),
      // Pin conversation, remote state
      (state) =>
        this._pinConversation.pipe(
          switchMap((conversationId) => {
            return this.upsertUserPreferences(state().recordId, {
              ...state(),
              pinnedConversations: this.addConversationIdToPinnedConversations(
                conversationId,
                state().pinnedConversations,
              ),
            });
          }),
        ),
      // Unpin conversation, remote state
      (state) =>
        this._unpinConversation.pipe(
          switchMap((conversationId) => {
            return this.upsertUserPreferences(state().recordId, {
              ...state(),
              pinnedConversations: state().pinnedConversations.filter(
                (id) => id !== conversationId,
              ),
            });
          }),
        ),
    ],
    actionSources: {
      pinConversation: this._pinConversation,
      unpinConversation: this._unpinConversation,
    },
  });

  // sources
  public pinConversation = (conversationId: string) => {
    this.state.pinConversation(conversationId);
  };
  public unpinConversation = (conversationId: string) => {
    this.state.unpinConversation(conversationId);
  };

  // private methods
  private addConversationIdToPinnedConversations(
    conversationId: string,
    pinnedConversations: Array<string>,
  ): Array<string> {
    // Helper method that only adds the conversationId if not already in the list
    // Returns a new array so it can be used with the state
    if (pinnedConversations.includes(conversationId)) {
      return [...pinnedConversations];
    }
    return [...pinnedConversations, conversationId];
  }

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
      catchError((error) => {
        console.error('Failed to fetch user preferences', error);
        this._errorService.alert('Failed to fetch user preferences');
        return EMPTY;
      }),
      map((record) => {
        return {
          ...this.decryptUserPreferencesData(Base64.toUint8Array(record.data)),
          recordId: record.id,
        };
      }),
    );
  }

  private upsertUserPreferences(
    recordId: string | undefined,
    preferences: UserPreferencesData,
  ): Observable<Partial<UserPreferencesState>> {
    let request: Observable<UserPreferencesResponse>;
    if (recordId) {
      request = this.updateUserPreferences(recordId, preferences);
    } else {
      request = this.saveUserPreferences(preferences);
    }

    return request.pipe(
      map((record) => {
        return {
          ...this.decryptUserPreferencesData(Base64.toUint8Array(record.data)),
          recordId: record.id,
        };
      }),
    );
  }

  private saveUserPreferences(
    preferences: UserPreferencesData,
  ): Observable<UserPreferencesResponse> {
    const encryptedData = this.encryptUserPreferencesData(preferences);

    return from(
      this._pbUserPreferencesCollection.create({
        user: this._authService.user()?.['id'],
        data: Base64.fromUint8Array(encryptedData),
      }),
    ).pipe(
      catchError((error) => {
        console.error('Failed to save user preferences', error);
        this._errorService.alert('Failed to save user preferences');
        return EMPTY;
      }),
    );
  }

  private updateUserPreferences(
    recordId: string,
    preferences: UserPreferencesData,
  ): Observable<UserPreferencesResponse> {
    const encryptedData = this.encryptUserPreferencesData(preferences);

    return from(
      this._pbUserPreferencesCollection.update(recordId, {
        data: Base64.fromUint8Array(encryptedData),
      }),
    ).pipe(
      catchError((error) => {
        console.error('Failed to update user preferences', error);
        this._errorService.alert('Failed to update user preferences');
        return EMPTY;
      }),
    );
  }

  public isConversationPinned(conversationId: string): boolean {
    return this.state().pinnedConversations.includes(conversationId);
  }
}
