import { Injectable, Signal, computed } from '@angular/core';

import { signalSlice } from 'ngxtension/signal-slice';

import { Model, defaultModel, hardCodedModels } from '@app/interfaces/model';

interface ModelState {
  modelList: Model[];
  selectedModelId: string;
}

const initialState: ModelState = {
  modelList: hardCodedModels,
  selectedModelId: 'cloudflare:llama-3-8b-instruct',
};

@Injectable({
  providedIn: 'root',
})
export class ModelService {
  private state = signalSlice({
    initialState,
    sources: [],
  });

  // selectors
  public selectedModel = computed(() => {
    const selectedModel = this.state().modelList.find(
      (model) => model.id === this.state().selectedModelId,
    );

    return selectedModel || defaultModel;
  });

  public getModel(id: string): Signal<Model | undefined> {
    return computed(() => this.state().modelList.find((model) => model.id === id));
  }
}
