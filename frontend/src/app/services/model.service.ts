import { Injectable, inject } from '@angular/core';

import { Observable, catchError, map, of, switchMap } from 'rxjs';

import { signalSlice } from 'ngxtension/signal-slice';

import { Model, loadingModel } from '@app/interfaces/model';

import { AuthService } from './auth.service';
import { CognosApiService } from './cognos-api.service';
import { UserPreferencesService } from './user-preferences.service';

interface ModelState {
  modelList: Model[];
  selectedModelId: string;
}

const initialState: ModelState = {
  modelList: [],
  selectedModelId: '',
};

@Injectable({
  providedIn: 'root',
})
export class ModelService {
  private readonly _authService = inject(AuthService);
  private readonly _api = inject(CognosApiService);
  private readonly _preferences = inject(UserPreferencesService);

  private readonly state = signalSlice({
    initialState,
    sources: [
      this._authService.user$.pipe(
        switchMap((user) => {
          if (!user) {
            return of(initialState);
          }

          return this._api.getModels().pipe(
            // selectedModelId stays empty here; the active model is derived
            // (selectedModel selector) from the manual pick, then the user's
            // persisted default, then the first eligible model. That avoids a
            // race with the encrypted preferences, which decrypt after unlock.
            map((response) => ({ modelList: response.models })),
            catchError((error) => {
              console.error('Failed to load models', error);
              return of(initialState);
            }),
          );
        }),
      ),
    ],
    selectors: (state) => ({
      selectedModel: () => {
        const modelList = state.modelList();
        const eligibleById = (id: string) =>
          id
            ? modelList.find((model) => model.id === id && model.isEligible)
            : undefined;

        return (
          // 1. an explicit pick this session, 2. the persisted default from the
          // single preferences object, 3. the first eligible model.
          eligibleById(state.selectedModelId()) ??
          eligibleById(this._preferences.defaultModelId()) ??
          modelList.find((model) => model.isEligible) ??
          modelList[0] ??
          loadingModel
        );
      },
      groupedModels: () => {
        return state.modelList().reduce<Record<string, Array<Model>>>((acc, model) => {
          if (!acc[model.providerId]) {
            acc[model.providerId] = [];
          }
          acc[model.providerId].push(model);
          return acc;
        }, {});
      },
    }),
    actionSources: {
      selectModel: (state, $action: Observable<string>) => {
        return $action.pipe(
          map((id) => {
            const model = state().modelList.find((candidate) => candidate.id === id);
            if (!model || !model.isEligible) {
              return {};
            }
            // Picking a model also makes it the default, persisted to the single
            // preferences object so it is restored next session / on new devices.
            this._preferences.setDefaultModel(id);
            return {
              selectedModelId: id,
            };
          }),
        );
      },
    },
  });

  readonly selectedModel = this.state.selectedModel;
  readonly modelList = this.state.modelList;
  readonly selectModel = this.state.selectModel;
  readonly groupedModels = this.state.groupedModels;

  getModel(id?: string): Model | undefined {
    if (!id) {
      return undefined;
    }

    return this.state().modelList.find((model) => model.id === id);
  }
}
