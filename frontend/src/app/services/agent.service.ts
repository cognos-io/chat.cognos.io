import { Injectable, signal } from '@angular/core';

import { signalSlice } from 'ngxtension/signal-slice';

import { Agent } from '@app/interfaces/agent';

interface AgentState {}

const initialState: AgentState = {};

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
    name: 'Agent 1',
    slug: 'agent-1',
    description: 'This is the first agent',
  });
}
