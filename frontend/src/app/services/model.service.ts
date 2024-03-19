import { Injectable, signal } from '@angular/core';

import { signalSlice } from 'ngxtension/signal-slice';

import { Model } from '@app/interfaces/model';

interface ModelState {
  selectedModel: Model | null;
}

const initialState: ModelState = {
  selectedModel: null,
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
  public selectedModel = signal<Model>({
    name: 'Model 1',
    slug: 'model-1',
    description: 'This is the first model',
  });
}
