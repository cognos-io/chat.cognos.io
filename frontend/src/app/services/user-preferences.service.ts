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

import { TranslocoService } from '@jsverse/transloco';
import { Base64 } from 'js-base64';
import { signalSlice } from 'ngxtension/signal-slice';

import {
  UserPreferencesData,
  emptyPreferences,
  parseUserPreferencesData,
  serializeUserPreferencesData,
} from '@app/interfaces/user_preferences';
import { ignorePocketbase404 } from '@app/operators/ignore-404';
import { addRecentModel } from '@app/utils/model-discovery';

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
  private readonly _transloco = inject(TranslocoService);

  private readonly _pinConversation = new Subject<string>();
  private readonly _unpinConversation = new Subject<string>();
  private readonly _pinModel = new Subject<string>();
  private readonly _unpinModel = new Subject<string>();
  private readonly _pinPersona = new Subject<string>();
  private readonly _unpinPersona = new Subject<string>();
  private readonly _setDefaultPersona = new Subject<string>();
  private readonly _setDefaultModel = new Subject<string>();
  private readonly _setToolModelDefault = new Subject<{
    contextKey: string;
    modelId: string;
  }>();
  private readonly _markRecentPersona = new Subject<string>();
  private readonly _markRecentModel = new Subject<string>();
  private readonly _hideModel = new Subject<string>();
  private readonly _unhideModel = new Subject<string>();
  private readonly _resetHiddenModels = new Subject<void>();
  private readonly _setRedactionEnabled = new Subject<boolean>();
  private readonly _setModelReasoningEffort = new Subject<{
    modelId: string;
    effort: string;
  }>();
  private readonly _setModelQuickFilter = new Subject<
    UserPreferencesData['modelQuickFilter']
  >();
  private readonly _setModelSortMode = new Subject<
    UserPreferencesData['modelSortMode']
  >();

  // Most-recently-used personas are capped so the "recently used" group and the
  // in-chat switcher stay short.
  private static readonly recentPersonaLimit = 8;

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
      // Pin persona, local then remote
      (state) =>
        this._pinPersona.pipe(
          map((personaId) => ({
            pinnedPersonas: this.addIdToList(personaId, state().pinnedPersonas),
          })),
        ),
      (state) =>
        this._pinPersona.pipe(
          concatMap((personaId) =>
            this.upsertUserPreferences(state().recordId, {
              ...state(),
              pinnedPersonas: this.addIdToList(personaId, state().pinnedPersonas),
            }),
          ),
        ),
      // Unpin persona, local then remote
      (state) =>
        this._unpinPersona.pipe(
          map((personaId) => ({
            pinnedPersonas: state().pinnedPersonas.filter((id) => id !== personaId),
          })),
        ),
      (state) =>
        this._unpinPersona.pipe(
          concatMap((personaId) =>
            this.upsertUserPreferences(state().recordId, {
              ...state(),
              pinnedPersonas: state().pinnedPersonas.filter((id) => id !== personaId),
            }),
          ),
        ),
      // Set default persona, local then remote
      () =>
        this._setDefaultPersona.pipe(
          map((personaId) => ({ defaultPersonaId: personaId })),
        ),
      (state) =>
        this._setDefaultPersona.pipe(
          concatMap((personaId) =>
            this.upsertUserPreferences(state().recordId, {
              ...state(),
              defaultPersonaId: personaId,
            }),
          ),
        ),
      // Set default model, local then remote
      () => this._setDefaultModel.pipe(map((modelId) => ({ defaultModelId: modelId }))),
      (state) =>
        this._setDefaultModel.pipe(
          concatMap((modelId) =>
            this.upsertUserPreferences(state().recordId, {
              ...state(),
              defaultModelId: modelId,
            }),
          ),
        ),
      // Set a per-capability-context default model, local then remote. Keyed by
      // context (e.g. "image_generation") so toggling a tool restores its model.
      (state) =>
        this._setToolModelDefault.pipe(
          map(({ contextKey, modelId }) => ({
            toolModelDefaults: {
              ...state().toolModelDefaults,
              [contextKey]: modelId,
            },
          })),
        ),
      (state) =>
        this._setToolModelDefault.pipe(
          concatMap(({ contextKey, modelId }) =>
            this.upsertUserPreferences(state().recordId, {
              ...state(),
              toolModelDefaults: {
                ...state().toolModelDefaults,
                [contextKey]: modelId,
              },
            }),
          ),
        ),
      // Toggle PII redaction, local then remote
      () =>
        this._setRedactionEnabled.pipe(
          map((enabled) => ({ redactionEnabled: enabled })),
        ),
      (state) =>
        this._setRedactionEnabled.pipe(
          concatMap((enabled) =>
            this.upsertUserPreferences(state().recordId, {
              ...state(),
              redactionEnabled: enabled,
            }),
          ),
        ),
      // Remember a per-model reasoning effort, local then remote
      (state) =>
        this._setModelReasoningEffort.pipe(
          map(({ modelId, effort }) => ({
            modelReasoningEfforts: {
              ...state().modelReasoningEfforts,
              [modelId]: effort,
            },
          })),
        ),
      (state) =>
        this._setModelReasoningEffort.pipe(
          concatMap(({ modelId, effort }) =>
            this.upsertUserPreferences(state().recordId, {
              ...state(),
              modelReasoningEfforts: {
                ...state().modelReasoningEfforts,
                [modelId]: effort,
              },
            }),
          ),
        ),
      // Remember model explorer filter, including null (no active filter).
      () =>
        this._setModelQuickFilter.pipe(
          map((modelQuickFilter) => ({ modelQuickFilter })),
        ),
      (state) =>
        this._setModelQuickFilter.pipe(
          concatMap((modelQuickFilter) =>
            this.upsertUserPreferences(state().recordId, {
              ...state(),
              modelQuickFilter,
            }),
          ),
        ),
      // Remember the model picker's chosen ordering, local then remote.
      () => this._setModelSortMode.pipe(map((modelSortMode) => ({ modelSortMode }))),
      (state) =>
        this._setModelSortMode.pipe(
          concatMap((modelSortMode) =>
            this.upsertUserPreferences(state().recordId, {
              ...state(),
              modelSortMode,
            }),
          ),
        ),
      // Mark persona recently used, local then remote
      (state) =>
        this._markRecentPersona.pipe(
          map((personaId) => ({
            recentPersonas: this.prependRecentPersona(
              personaId,
              state().recentPersonas,
            ),
          })),
        ),
      (state) =>
        this._markRecentPersona.pipe(
          concatMap((personaId) =>
            this.upsertUserPreferences(state().recordId, {
              ...state(),
              recentPersonas: this.prependRecentPersona(
                personaId,
                state().recentPersonas,
              ),
            }),
          ),
        ),
      // Mark model recently used, local then remote
      (state) =>
        this._markRecentModel.pipe(
          map((modelId) => ({
            recentModels: addRecentModel(modelId, state().recentModels),
          })),
        ),
      (state) =>
        this._markRecentModel.pipe(
          concatMap((modelId) =>
            this.upsertUserPreferences(state().recordId, {
              ...state(),
              recentModels: addRecentModel(modelId, state().recentModels),
            }),
          ),
        ),
      // Hide model, local then remote
      (state) =>
        this._hideModel.pipe(
          map((modelId) => ({
            hiddenModels: this.addIdToList(modelId, state().hiddenModels),
          })),
        ),
      (state) =>
        this._hideModel.pipe(
          concatMap((modelId) =>
            this.upsertUserPreferences(state().recordId, {
              ...state(),
              hiddenModels: this.addIdToList(modelId, state().hiddenModels),
            }),
          ),
        ),
      // Unhide model, local then remote
      (state) =>
        this._unhideModel.pipe(
          map((modelId) => ({
            hiddenModels: state().hiddenModels.filter((id) => id !== modelId),
          })),
        ),
      (state) =>
        this._unhideModel.pipe(
          concatMap((modelId) =>
            this.upsertUserPreferences(state().recordId, {
              ...state(),
              hiddenModels: state().hiddenModels.filter((id) => id !== modelId),
            }),
          ),
        ),
      // Reset all hidden models, local then remote
      () => this._resetHiddenModels.pipe(map(() => ({ hiddenModels: [] }))),
      (state) =>
        this._resetHiddenModels.pipe(
          concatMap(() =>
            this.upsertUserPreferences(state().recordId, {
              ...state(),
              hiddenModels: [],
            }),
          ),
        ),
    ],
    actionSources: {
      pinConversation: this._pinConversation,
      unpinConversation: this._unpinConversation,
      pinModel: this._pinModel,
      unpinModel: this._unpinModel,
      pinPersona: this._pinPersona,
      unpinPersona: this._unpinPersona,
      setDefaultPersona: this._setDefaultPersona,
      setDefaultModel: this._setDefaultModel,
      setToolModelDefault: this._setToolModelDefault,
      markRecentPersona: this._markRecentPersona,
      markRecentModel: this._markRecentModel,
      hideModel: this._hideModel,
      unhideModel: this._unhideModel,
      resetHiddenModels: this._resetHiddenModels,
      setRedactionEnabled: this._setRedactionEnabled,
      setModelReasoningEffort: this._setModelReasoningEffort,
      setModelQuickFilter: this._setModelQuickFilter,
      setModelSortMode: this._setModelSortMode,
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
  public pinPersona = (personaId: string) => {
    this.state.pinPersona(personaId);
  };
  public unpinPersona = (personaId: string) => {
    this.state.unpinPersona(personaId);
  };
  public setDefaultPersona = (personaId: string) => {
    this.state.setDefaultPersona(personaId);
  };
  public setDefaultModel = (modelId: string) => {
    this.state.setDefaultModel(modelId);
  };
  public setToolModelDefault = (contextKey: string, modelId: string) => {
    this.state.setToolModelDefault({ contextKey, modelId });
  };
  public markRecentPersona = (personaId: string) => {
    this.state.markRecentPersona(personaId);
  };
  public markRecentModel = (modelId: string) => {
    this.state.markRecentModel(modelId);
  };
  public hideModel = (modelId: string) => {
    this.state.hideModel(modelId);
  };
  public unhideModel = (modelId: string) => {
    this.state.unhideModel(modelId);
  };
  public resetHiddenModels = () => {
    this.state.resetHiddenModels();
  };
  public setRedactionEnabled = (enabled: boolean) => {
    this.state.setRedactionEnabled(enabled);
  };
  public setModelReasoningEffort = (modelId: string, effort: string) => {
    this.state.setModelReasoningEffort({ modelId, effort });
  };
  public setModelQuickFilter = (filter: UserPreferencesData['modelQuickFilter']) => {
    this.state.setModelQuickFilter(filter);
  };
  public setModelSortMode = (mode: UserPreferencesData['modelSortMode']) => {
    this.state.setModelSortMode(mode);
  };

  // selectors
  public pinnedConversationIds = this.state.pinnedConversations;
  public pinnedModels = this.state.pinnedModels;
  public pinnedPersonas = this.state.pinnedPersonas;
  public recentPersonas = this.state.recentPersonas;
  public defaultPersonaId = this.state.defaultPersonaId;
  public defaultModelId = this.state.defaultModelId;
  public redactionEnabled = this.state.redactionEnabled;
  public modelReasoningEfforts = this.state.modelReasoningEfforts;
  public recentModels = this.state.recentModels;
  public hiddenModels = this.state.hiddenModels;
  public toolModelDefaults = this.state.toolModelDefaults;
  public modelQuickFilter = this.state.modelQuickFilter;
  public modelSortMode = this.state.modelSortMode;

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

  // Most-recent-first, de-duplicated, capped.
  private prependRecentPersona(id: string, list: Array<string>): Array<string> {
    return [id, ...list.filter((existing) => existing !== id)].slice(
      0,
      UserPreferencesService.recentPersonaLimit,
    );
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
        this._errorService.alert(this._transloco.translate('errors.fetchPreferences'));
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
          this._errorService.alert(this._transloco.translate('errors.savePreferences'));
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
          this._errorService.alert(
            this._transloco.translate('errors.updatePreferences'),
          );
          return EMPTY;
        }),
      );
  }

  public isConversationPinned(conversationId: string): boolean {
    return this.pinnedConversationIds().includes(conversationId);
  }

  public isModelPinned(modelId: string): boolean {
    return this.state().pinnedModels.includes(modelId);
  }

  public isModelHidden(modelId: string): boolean {
    return this.state().hiddenModels.includes(modelId);
  }

  public isPersonaPinned(personaId: string): boolean {
    return this.state().pinnedPersonas.includes(personaId);
  }
}
