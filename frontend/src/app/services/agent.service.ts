import { Injectable, signal } from '@angular/core';

import { signalSlice } from 'ngxtension/signal-slice';

import { Agent } from '@app/interfaces/agent';

interface AgentState {
  agentList: Agent[];
}

const initialState: AgentState = {
  agentList: [],
};

@Injectable({
  providedIn: 'root',
})
export class AgentService {
  private state = signalSlice({
    initialState,
    sources: [],
  });

  // selectors
  public selectedAgent = signal<Agent>({
    id: 'openai:gpt-3.5-turbo',
    name: 'Open AI - GPT 3.5 Turbo',
    slug: 'open-ai---gpt-35-turbo',
    description: 'This is the first agent',
  });
}
