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
    id: 'openai:gpt-3.5-turbo',
    name: 'Open AI - GPT 3.5 Turbo',
    slug: 'open-ai---gpt-35-turbo',
    description: 'This is the first model',
  });
}
