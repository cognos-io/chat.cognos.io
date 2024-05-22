import { Injectable, Signal, computed } from '@angular/core';

import { Observable, map } from 'rxjs';

import { signalSlice } from 'ngxtension/signal-slice';

import { Agent, defaultAgent } from '@app/interfaces/agent';

interface AgentState {
  agentList: Agent[];
  selectedAgentId: string;
}

const initialState: AgentState = {
  agentList: [defaultAgent],
  selectedAgentId: defaultAgent.id,
};

@Injectable({
  providedIn: 'root',
})
export class AgentService {
  private state = signalSlice({
    initialState,
    sources: [],
    selectors: (state) => ({
      selectedAgent: () => {
        const selectedAgent = state
          .agentList()
          .find((agent) => agent.id === state.selectedAgentId());

        return selectedAgent || defaultAgent;
      },
    }),
    actionSources: {
      selectAgent: (state, $action: Observable<string>) => {
        return $action.pipe(
          map((id) => {
            const agent = state().agentList.find((agent) => agent.id === id);
            if (!agent) {
              return {};
            }
            return {
              selectedAgentId: id,
            };
          }),
        );
      },
    },
  });

  // selectors
  public readonly agentList = this.state.agentList;
  public readonly selectedAgent = this.state.selectedAgent;

  public selectAgent = this.state.selectAgent;

  public getAgent(id: string): Signal<Agent | undefined> {
    return computed(() => this.state().agentList.find((agent) => agent.id === id));
  }
}
