export const ADOPTION_STATE_VERSION = 1 as const;

export type AdoptionMilestone =
  | 'first_message_24h'
  | 'three_conversations_7d'
  | 'week_2_return';

export interface AdoptionState {
  version: typeof ADOPTION_STATE_VERSION;
  signupAt: number;
  conversationsCreated: number;
  conversationsUsed: number;
  creditedConversationCreations: number;
  emitted: Record<AdoptionMilestone, boolean>;
  welcomeDismissed: boolean;
  habitDismissed: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function newAdoptionState(now: number): AdoptionState {
  return {
    version: ADOPTION_STATE_VERSION,
    signupAt: now,
    conversationsCreated: 0,
    conversationsUsed: 0,
    creditedConversationCreations: 0,
    emitted: {
      first_message_24h: false,
      three_conversations_7d: false,
      week_2_return: false,
    },
    welcomeDismissed: false,
    habitDismissed: false,
  };
}

export function parseAdoptionState(raw: string | null): AdoptionState | null {
  if (!raw) {
    return null;
  }
  try {
    const value: unknown = JSON.parse(raw);
    if (!isRecord(value) || value['version'] !== ADOPTION_STATE_VERSION) {
      return null;
    }
    const signupAt = safeNonNegative(value['signupAt']);
    const conversationsCreated = safeInteger(value['conversationsCreated']);
    const conversationsUsed = safeInteger(value['conversationsUsed']);
    const credited = safeInteger(value['creditedConversationCreations']);
    const emitted = value['emitted'];
    if (signupAt === null || !isRecord(emitted)) {
      return null;
    }
    return {
      version: ADOPTION_STATE_VERSION,
      signupAt,
      conversationsCreated,
      conversationsUsed,
      creditedConversationCreations: Math.min(credited, conversationsCreated),
      emitted: {
        first_message_24h: emitted['first_message_24h'] === true,
        three_conversations_7d: emitted['three_conversations_7d'] === true,
        week_2_return: emitted['week_2_return'] === true,
      },
      welcomeDismissed: value['welcomeDismissed'] === true,
      habitDismissed: value['habitDismissed'] === true,
    };
  } catch {
    return null;
  }
}

export function recordConversationCreated(state: AdoptionState): AdoptionState {
  return { ...state, conversationsCreated: state.conversationsCreated + 1 };
}

export function recordMessageSent(
  state: AdoptionState,
  now: number,
): { state: AdoptionState; milestones: AdoptionMilestone[] } {
  const age = now - state.signupAt;
  const emitted = { ...state.emitted };
  const milestones: AdoptionMilestone[] = [];
  let conversationsUsed = state.conversationsUsed;
  let credited = state.creditedConversationCreations;

  if (credited < state.conversationsCreated) {
    credited += 1;
    conversationsUsed += 1;
  }
  if (!emitted.first_message_24h && age >= 0 && age <= DAY_MS) {
    emitted.first_message_24h = true;
    milestones.push('first_message_24h');
  }
  if (
    !emitted.three_conversations_7d &&
    conversationsUsed >= 3 &&
    age >= 0 &&
    age <= 7 * DAY_MS
  ) {
    emitted.three_conversations_7d = true;
    milestones.push('three_conversations_7d');
  }
  return {
    state: {
      ...state,
      conversationsUsed,
      creditedConversationCreations: credited,
      emitted,
    },
    milestones,
  };
}

export function recordReturn(
  state: AdoptionState,
  now: number,
): { state: AdoptionState; milestones: AdoptionMilestone[] } {
  const age = now - state.signupAt;
  if (state.emitted.week_2_return || age < 8 * DAY_MS || age >= 15 * DAY_MS) {
    return { state, milestones: [] };
  }
  return {
    state: {
      ...state,
      emitted: { ...state.emitted, week_2_return: true },
    },
    milestones: ['week_2_return'],
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeNonNegative(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0
    ? value
    : null;
}

function safeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
    ? value
    : 0;
}
