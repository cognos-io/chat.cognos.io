import { Injectable, Signal, computed } from '@angular/core';

import { signalSlice } from 'ngxtension/signal-slice';

import { Agent, defaultAgent } from '@app/interfaces/agent';

interface AgentState {
  agentList: Agent[];
  selectedAgentId: string;
}

const initialState: AgentState = {
  agentList: [],
  selectedAgentId: '',
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
  public readonly selectedAgent = computed(() => {
    const selectedAgent = this.state().agentList.find(
      (agent) => agent.id === this.state().selectedAgentId,
    );

    return selectedAgent || defaultAgent;
  });

  public getAgent(id: string): Signal<Agent | undefined> {
    return computed(() => this.state().agentList.find((agent) => agent.id === id));
  }
}
