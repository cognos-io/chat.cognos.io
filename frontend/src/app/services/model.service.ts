import { Injectable, Signal, computed, signal } from '@angular/core';

import { Observable, map } from 'rxjs';

import { signalSlice } from 'ngxtension/signal-slice';

import { Model, defaultModel, hardCodedModels } from '@app/interfaces/model';

interface ModelState {
  modelList: Model[];
  selectedModelId: string;
}

const initialState: ModelState = {
  modelList: hardCodedModels,
  selectedModelId: defaultModel.id,
};

@Injectable({
  providedIn: 'root',
})
export class ModelService {
  private state = signalSlice({
    initialState,
    sources: [],
    selectors: (state) => ({
      selectedModel: () => {
        const selectedModel = state
          .modelList()
          .find((model) => model.id === state.selectedModelId());

        return selectedModel || defaultModel;
      },
      groupedModels: () => {
        return state
          .modelList()
          .reduce<{ [key: string]: Array<Model> }>((acc, model) => {
            const providerId = model.providerId;
            if (!acc[providerId]) {
              acc[providerId] = [];
            }
            acc[providerId].push(model);
            return acc;
          }, {});
      },
    }),
    actionSources: {
      selectModel: (state, $action: Observable<string>) => {
        return $action.pipe(
          map((id) => {
            const model = state().modelList.find((model) => model.id === id);
            if (!model) {
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

  // selectors
  public selectedModel = this.state.selectedModel;
  public modelList = this.state.modelList;

  public selectModel = this.state.selectModel;
  public groupedModels = this.state.groupedModels;

  public getModel(id?: string): Signal<Model | undefined> {
    if (!id) {
      return signal(undefined);
    }
    return computed(() => this.state().modelList.find((model) => model.id === id));
  }
}
