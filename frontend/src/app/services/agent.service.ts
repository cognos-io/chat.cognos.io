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
    id: 'cognos:simple-assistant',
    name: 'Cognos - A simple assistant',
    slug: 'cognos--simple-assistant',
    description: 'This is the first agent',
  });
}
