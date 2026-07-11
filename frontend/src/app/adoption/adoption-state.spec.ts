import fc from 'fast-check';

import {
  newAdoptionState,
  parseAdoptionState,
  recordConversationCreated,
  recordMessageSent,
  recordReturn,
} from './adoption-state';

const DAY_MS = 24 * 60 * 60 * 1000;

describe('adoption state', () => {
  it('emits first-message and three-Conversation milestones only once', () => {
    let state = newAdoptionState(0);
    const emitted: string[] = [];
    for (let index = 0; index < 3; index += 1) {
      state = recordConversationCreated(state);
      const result = recordMessageSent(state, DAY_MS);
      state = result.state;
      emitted.push(...result.milestones);
    }

    expect(emitted).toEqual(['first_message_24h', 'three_conversations_7d']);
    expect(recordMessageSent(state, DAY_MS).milestones).toEqual([]);
  });

  it('emits a return only during days 8 to 14', () => {
    const state = newAdoptionState(0);

    expect(recordReturn(state, 7 * DAY_MS).milestones).toEqual([]);
    expect(recordReturn(state, 8 * DAY_MS).milestones).toEqual(['week_2_return']);
    expect(recordReturn(state, 15 * DAY_MS).milestones).toEqual([]);
  });

  it('never throws or accepts arbitrary JSON as trusted state', () => {
    fc.assert(
      fc.property(fc.jsonValue(), (value) => {
        const parsed = parseAdoptionState(JSON.stringify(value));
        if (parsed) {
          expect(parsed.version).toBe(1);
          expect(parsed.conversationsCreated).toBeGreaterThanOrEqual(0);
          expect(parsed.conversationsUsed).toBeGreaterThanOrEqual(0);
        }
      }),
    );
  });

  it('contains no content-bearing fields', () => {
    expect(Object.keys(newAdoptionState(0)).sort()).toEqual([
      'conversationsCreated',
      'conversationsUsed',
      'creditedConversationCreations',
      'emitted',
      'habitDismissed',
      'signupAt',
      'version',
      'welcomeDismissed',
    ]);
  });
});
