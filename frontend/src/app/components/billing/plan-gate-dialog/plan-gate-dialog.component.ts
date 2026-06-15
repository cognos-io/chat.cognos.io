import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';

import {
  CognosButtonComponent,
  CognosDialogSurfaceComponent,
} from '@cognos/ui-angular';

import { BillingPlanType, PlanGateReason } from '@app/interfaces/billing';

export interface PlanGateDialogData {
  reason: PlanGateReason;
}

// PlanGateDialogComponent is shown when billing blocks a send — either the
// trial credit is exhausted or the plan went inactive. It presents the two
// plans with the up-front-charge disclosure the spec is emphatic about
// (§13.2). Choosing a plan resolves with the plan id; the caller routes on to
// checkout. Placeholder visuals — wired to Paddle in a later case.
@Component({
  selector: 'app-plan-gate-dialog',
  standalone: true,
  imports: [CognosDialogSurfaceComponent, CognosButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <cog-dialog-surface
      [title]="title()"
      [subtitle]="subtitle()"
      [width]="560"
      (close)="close()"
    >
      <div class="plan-gate">
        <div class="plan-gate__plans">
          <section class="plan-gate__plan">
            <h3 class="plan-gate__name">Pay-As-You-Go</h3>
            <p class="plan-gate__price">CHF 10.00 / month minimum</p>
            <p class="plan-gate__detail">
              CHF 10.00 is charged now for this month's minimum. If your usage goes
              above CHF 10.00, the extra is added to your next monthly invoice. You're
              never charged less than CHF 10.00 per month while subscribed.
            </p>
            <cog-button appearance="primary" type="button" (click)="choose('payg')">
              Choose Pay-As-You-Go
            </cog-button>
          </section>

          <section class="plan-gate__plan">
            <h3 class="plan-gate__name">Unlimited</h3>
            <p class="plan-gate__price">CHF 100.00 / month</p>
            <p class="plan-gate__detail">
              Unlimited conversational use, billed monthly. Subject to a fair-use policy
              for human, conversational use.
            </p>
            <cog-button
              appearance="primary"
              type="button"
              (click)="choose('unlimited')"
            >
              Choose Unlimited
            </cog-button>
          </section>
        </div>

        <p class="plan-gate__annual">
          Save CHF 200 with Unlimited Annual — CHF 1000 / year (about two months free).
        </p>

        <p class="plan-gate__tax">
          Prices exclude tax. Tax is added at checkout based on your location.
        </p>
      </div>
    </cog-dialog-surface>
  `,
  styles: `
    .plan-gate {
      display: grid;
      gap: var(--cog-space-150);
    }

    .plan-gate__plans {
      display: grid;
      gap: var(--cog-space-150);
    }

    @media (min-width: 600px) {
      .plan-gate__plans {
        grid-template-columns: 1fr 1fr;
      }
    }

    .plan-gate__plan {
      display: grid;
      gap: var(--cog-space-100);
      align-content: start;
      border: 1px solid var(--cog-border);
      border-radius: var(--cog-radius-sm);
      padding: var(--cog-space-150);
    }

    .plan-gate__name {
      margin: 0;
      color: var(--cog-text);
      font-size: var(--cog-fs-h-sm);
      font-weight: var(--cog-fw-h-sm);
      line-height: var(--cog-lh-h-sm);
    }

    .plan-gate__price {
      margin: 0;
      color: var(--cog-text);
      font-weight: var(--cog-fw-semibold);
    }

    .plan-gate__detail {
      margin: 0;
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-body-sm);
      line-height: var(--cog-lh-body-sm);
    }

    .plan-gate__plan cog-button {
      margin-top: var(--cog-space-050);
    }

    .plan-gate__annual {
      margin: 0;
      color: var(--cog-text);
      font-size: var(--cog-fs-body-sm);
    }

    .plan-gate__tax {
      margin: 0;
      color: var(--cog-text-subtlest);
      font-size: var(--cog-fs-caption);
      line-height: var(--cog-lh-caption);
    }
  `,
})
export class PlanGateDialogComponent {
  private readonly _ref = inject(DialogRef<BillingPlanType | undefined>);
  private readonly _data = inject<PlanGateDialogData>(DIALOG_DATA);

  protected readonly title = computed(() =>
    this._data.reason === 'inactive'
      ? 'Choose a plan to keep chatting'
      : 'Your free trial is used up',
  );

  protected readonly subtitle = computed(() =>
    this._data.reason === 'inactive'
      ? 'Your plan is no longer active. Pick a plan to start sending messages again — you can still read your existing chats.'
      : 'Pick a plan to keep chatting. You can still read your existing chats.',
  );

  protected choose(plan: BillingPlanType): void {
    this._ref.close(plan);
  }

  protected close(): void {
    this._ref.close(undefined);
  }
}
