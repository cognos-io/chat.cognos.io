import { TestBed } from '@angular/core/testing';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { Agent, defaultAgent } from '@app/interfaces/agent';

import { AgentService } from './agent.service';

describe('AgentService', () => {
  let service: AgentService;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [AgentService] });
    service = TestBed.inject(AgentService);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it('defaults to the simple-assistant agent on first load', () => {
    expect(service.selectedAgent()).toEqual(defaultAgent);
  });

  it('returns an undefined-signal for getAgent when no id is supplied', () => {
    expect(service.getAgent(undefined)()).toBeUndefined();
  });

  it('returns an undefined-signal for getAgent when the id is unknown', () => {
    expect(service.getAgent('cognos:not-real')()).toBeUndefined();
  });

  it('resolves getAgent for the seeded default agent id', () => {
    expect(service.getAgent(defaultAgent.id)()).toEqual(defaultAgent);
  });

  it('ignores selectAgent calls for ids that are not in the agent list', () => {
    service.selectAgent('cognos:not-real');
    // selectedAgent must fall back to the default rather than returning an
    // undefined agent: the chat flow expects this signal to always carry a
    // usable agent so callers don't have to null-guard it.
    expect(service.selectedAgent()).toEqual(defaultAgent);
  });

  it('falls back to the default agent if selectedAgentId points to a missing agent', () => {
    // This pins the safety net inside selectedAgent — if the agent list ever
    // shrinks and the previously-selected id disappears, the user keeps a
    // working agent instead of crashing the chat box.
    const orphan: Agent = {
      id: 'cognos:does-not-exist',
      name: 'orphan',
      slug: 'orphan',
      description: 'orphan',
      authorId: 'cognos',
    };
    service.selectAgent(orphan.id);

    expect(service.selectedAgent()).toEqual(defaultAgent);
  });
});
