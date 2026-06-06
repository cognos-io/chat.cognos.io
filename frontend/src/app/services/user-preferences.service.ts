import { Injectable, inject } from '@angular/core';

import {
  EMPTY,
  Observable,
  Subject,
  catchError,
  concatMap,
  map,
  of,
  switchMap,
} from 'rxjs';

import { Base64 } from 'js-base64';
import { signalSlice } from 'ngxtension/signal-slice';

import {
  UserPreferencesData,
  emptyPreferences,
  parseUserPreferencesData,
  serializeUserPreferencesData,
} from '@app/interfaces/user_preferences';
import { ignorePocketbase404 } from '@app/operators/ignore-404';

import { UserPreferencesResponse } from '../types/pocketbase-types';
import { CognosApiService } from './cognos-api.service';
import { CryptoService } from './crypto.service';
import { ErrorService } from './error.service';
import { VaultService } from './vault.service';

interface UserPreferencesState extends UserPreferencesData {
  // null means the record does not exist, undefined we haven't loaded it yet
  recordId: string | undefined;
}

const initialState: UserPreferencesState = {
  ...emptyPreferences,
  recordId: undefined,
};

@Injectable({
  providedIn: 'root',
})
export class UserPreferencesService {
  private readonly _api = inject(CognosApiService);
  private readonly _cryptoService = inject(CryptoService);
  private readonly _vaultService = inject(VaultService);
  private readonly _errorService = inject(ErrorService);

  private readonly _pinConversation = new Subject<string>();
  private readonly _unpinConversation = new Subject<string>();
  private readonly _pinModel = new Subject<string>();
  private readonly _unpinModel = new Subject<string>();

  // TODO(ewan): We need a better way to trigger the remote updating of preferences
  // e.g. a global state state trigger that reacts to state changes, sends the newly updated state to the backend and replaces the local state with the response
  private state = signalSlice({
    initialState,
    sources: [
      // We are dependent on the key pair, so we need to wait for it to be loaded
      this._vaultService.keyPair$.pipe(
        switchMap((keyPair) => {
          if (keyPair) {
            return this.fetchUserPreferences();
          }
          return of(initialState);
        }),
      ),
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
          concatMap((conversationId) => {
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
          concatMap((conversationId) => {
            return this.upsertUserPreferences(state().recordId, {
              ...state(),
              pinnedConversations: state().pinnedConversations.filter(
                (id) => id !== conversationId,
              ),
            });
          }),
        ),
      // Pin model, local state
      (state) =>
        this._pinModel.pipe(
          map((modelId) => {
            return {
              pinnedModels: this.addIdToList(modelId, state().pinnedModels),
            };
          }),
        ),
      // Unpin model, local state
      (state) =>
        this._unpinModel.pipe(
          map((modelId) => {
            return {
              pinnedModels: state().pinnedModels.filter((id) => id !== modelId),
            };
          }),
        ),
      // Pin model, remote state
      (state) =>
        this._pinModel.pipe(
          concatMap((modelId) => {
            return this.upsertUserPreferences(state().recordId, {
              ...state(),
              pinnedModels: this.addIdToList(modelId, state().pinnedModels),
            });
          }),
        ),
      // Unpin model, remote state
      (state) =>
        this._unpinModel.pipe(
          concatMap((modelId) => {
            return this.upsertUserPreferences(state().recordId, {
              ...state(),
              pinnedModels: state().pinnedModels.filter((id) => id !== modelId),
            });
          }),
        ),
    ],
    actionSources: {
      pinConversation: this._pinConversation,
      unpinConversation: this._unpinConversation,
      pinModel: this._pinModel,
      unpinModel: this._unpinModel,
    },
  });

  // sources
  public pinConversation = (conversationId: string) => {
    this.state.pinConversation(conversationId);
  };
  public unpinConversation = (conversationId: string) => {
    this.state.unpinConversation(conversationId);
  };
  public pinModel = (modelId: string) => {
    this.state.pinModel(modelId);
  };
  public unpinModel = (modelId: string) => {
    this.state.unpinModel(modelId);
  };

  // selectors
  public pinnedModels = this.state.pinnedModels;

  // private methods
  private addConversationIdToPinnedConversations(
    conversationId: string,
    pinnedConversations: Array<string>,
  ): Array<string> {
    return this.addIdToList(conversationId, pinnedConversations);
  }

  private addIdToList(id: string, list: Array<string>): Array<string> {
    if (list.includes(id)) {
      return [...list];
    }
    return [...list, id];
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
    return this._api.getUserPreferences().pipe(
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

    return this._api
      .createUserPreferences({
        data: Base64.fromUint8Array(encryptedData),
      })
      .pipe(
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

    return this._api
      .updateUserPreferences(recordId, {
        data: Base64.fromUint8Array(encryptedData),
      })
      .pipe(
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

  public isModelPinned(modelId: string): boolean {
    return this.state().pinnedModels.includes(modelId);
  }
}
