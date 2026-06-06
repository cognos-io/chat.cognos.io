import { Injectable, inject } from '@angular/core';

import { Observable, catchError, map, of, switchMap } from 'rxjs';

import { signalSlice } from 'ngxtension/signal-slice';

import { Model, loadingModel } from '@app/interfaces/model';

import { AuthService } from './auth.service';
import { CognosApiService } from './cognos-api.service';

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

  private readonly state = signalSlice({
    initialState,
    sources: [
      this._authService.user$.pipe(
        switchMap((user) => {
          if (!user) {
            return of(initialState);
          }

          return this._api.getModels().pipe(
            map((response) => ({
              modelList: response.models,
              selectedModelId: this.selectInitialModelID(
                response.models,
                response.preferredModelId,
              ),
            })),
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
        const selectedModel = modelList.find(
          (model) => model.id === state.selectedModelId(),
        );

        return selectedModel ?? modelList[0] ?? loadingModel;
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

  private selectInitialModelID(models: Model[], preferredModelId?: string): string {
    if (preferredModelId) {
      const preferredModel = models.find(
        (model) => model.id === preferredModelId && model.isEligible,
      );
      if (preferredModel) {
        return preferredModel.id;
      }
    }

    const firstEligibleModel = models.find((model) => model.isEligible);
    if (firstEligibleModel) {
      return firstEligibleModel.id;
    }

    return models[0]?.id ?? '';
  }
}
