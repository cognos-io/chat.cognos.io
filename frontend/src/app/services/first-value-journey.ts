import { Injectable, computed, effect, inject, signal } from '@angular/core';

import {
  AdoptionState,
  newAdoptionState,
  parseAdoptionState,
  recordConversationCreated,
  recordMessageSent,
  recordReturn,
} from '@app/adoption/adoption-state';

import { Analytics } from './analytics/analytics';
import { AuthService } from './auth.service';

export type FirstValueStarter = 'think' | 'draft' | 'plan';

@Injectable({
  providedIn: 'root',
})
export class FirstValueJourney {
  private readonly _auth = inject(AuthService);
  private readonly _analytics = inject(Analytics);
  private readonly _eligible = signal(false);
  private readonly _dismissed = signal(false);
  private readonly _starter = signal<FirstValueStarter | null>(null);
  private readonly _adoptionState = signal<AdoptionState | null>(null);
  private _accountId: string | null = null;

  readonly visible = computed(() => {
    const state = this._adoptionState();
    return (
      !this._dismissed() &&
      ((this._eligible() && !state) ||
        (!!state && !state.welcomeDismissed && state.conversationsUsed === 0))
    );
  });
  readonly habitVisible = computed(() => {
    const state = this._adoptionState();
    return !!state && !state.habitDismissed && state.conversationsUsed > 0;
  });
  readonly conversationsUsed = computed(
    () => this._adoptionState()?.conversationsUsed ?? 0,
  );
  readonly returnedInWeekTwo = computed(
    () => this._adoptionState()?.emitted.week_2_return ?? false,
  );

  constructor() {
    effect(() => {
      const accountId = this._auth.user()?.['id'] as string | undefined;
      this._accountId = accountId ?? null;
      if (!accountId) {
        this._adoptionState.set(null);
        return;
      }
      const state = this.readState(accountId);
      if (!state) {
        this._adoptionState.set(null);
        return;
      }
      this.applyResult(recordReturn(state, Date.now()));
    });
  }

  markEligible(): void {
    this._eligible.set(true);
    if (!this._adoptionState()) {
      const state = newAdoptionState(Date.now());
      this._adoptionState.set(state);
      this.persist(state);
    }
  }

  dismiss(): void {
    this._dismissed.set(true);
    const state = this._adoptionState();
    if (state) {
      const next = { ...state, welcomeDismissed: true };
      this._adoptionState.set(next);
      this.persist(next);
    }
  }

  selectStarter(starter: FirstValueStarter): void {
    this._starter.set(starter);
    this.dismiss();
  }

  takeStarter(): FirstValueStarter | null {
    const starter = this._starter();
    this._starter.set(null);
    return starter;
  }

  starterRevision(): FirstValueStarter | null {
    return this._starter();
  }

  recordConversationCreated(): void {
    const state = this._adoptionState();
    if (!state) {
      return;
    }
    const next = recordConversationCreated(state);
    this._adoptionState.set(next);
    this.persist(next);
  }

  recordMessageSent(): void {
    const state = this._adoptionState();
    if (state) {
      this.applyResult(recordMessageSent(state, Date.now()));
    }
  }

  dismissHabit(): void {
    const state = this._adoptionState();
    if (!state) {
      return;
    }
    const next = { ...state, habitDismissed: true };
    this._adoptionState.set(next);
    this.persist(next);
  }

  private applyResult(result: {
    state: AdoptionState;
    milestones: Array<'first_message_24h' | 'three_conversations_7d' | 'week_2_return'>;
  }): void {
    this._adoptionState.set(result.state);
    this.persist(result.state);
    for (const milestone of result.milestones) {
      this._analytics.track('adoption_milestone', { milestone });
    }
  }

  private readState(accountId: string): AdoptionState | null {
    if (typeof localStorage === 'undefined') {
      return null;
    }
    return parseAdoptionState(localStorage.getItem(this.storageKey(accountId)));
  }

  private persist(state: AdoptionState): void {
    if (!this._accountId || typeof localStorage === 'undefined') {
      return;
    }
    localStorage.setItem(this.storageKey(this._accountId), JSON.stringify(state));
  }

  private storageKey(accountId: string): string {
    return `cognos:adoption:v1:${accountId}`;
  }
}
