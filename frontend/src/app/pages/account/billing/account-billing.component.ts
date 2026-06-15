import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterLink } from '@angular/router';

import { CognosButtonComponent, CognosLozengeComponent } from '@cognos/ui-angular';

import { BillingService } from '@app/services/billing.service';

// AccountBillingComponent is a placeholder billing dashboard. It surfaces the
// current plan so the plan-gate CTA and the (upcoming) sidebar profile button
// have a real destination. The full dashboard — usage breakdown, invoices, the
// Paddle customer-portal link, plan switching — lands in a later case.
@Component({
  selector: 'app-account-billing',
  standalone: true,
  imports: [RouterLink, CognosButtonComponent, CognosLozengeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="account-billing">
      <header class="account-billing__header">
        <a routerLink="/" class="account-billing__back">← Back to chat</a>
        <h1 class="account-billing__title">Billing</h1>
      </header>

      <section class="account-billing__card">
        <div class="account-billing__plan">
          <span class="account-billing__label">Current plan</span>
          <cog-lozenge [tone]="planTone()">{{ planLabel() }}</cog-lozenge>
        </div>

        @if (billing.isTrial()) {
          <p class="account-billing__balance">
            CHF {{ billing.balanceChf().toFixed(2) }} of trial credit remaining.
          </p>
        }

        <p class="account-billing__note">
          Plan management and checkout are coming soon. Prices exclude tax — tax is
          added at checkout based on your location.
        </p>

        <div class="account-billing__actions">
          <cog-button appearance="primary" type="button" (click)="choosePlan()">
            Choose a plan
          </cog-button>
        </div>
      </section>
    </main>
  `,
  styles: `
    .account-billing {
      display: grid;
      gap: var(--cog-space-200);
      max-width: 640px;
      margin: 0 auto;
      padding: var(--cog-space-300) var(--cog-space-200);
    }

    .account-billing__header {
      display: grid;
      gap: var(--cog-space-100);
    }

    .account-billing__back {
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-body-sm);
      text-decoration: none;
    }

    .account-billing__title {
      margin: 0;
      color: var(--cog-text);
      font-size: var(--cog-fs-h-lg);
      font-weight: var(--cog-fw-h-lg);
      line-height: var(--cog-lh-h-lg);
    }

    .account-billing__card {
      display: grid;
      gap: var(--cog-space-150);
      border: 1px solid var(--cog-border);
      border-radius: var(--cog-radius-md);
      background: var(--cog-surface);
      padding: var(--cog-space-200);
    }

    .account-billing__plan {
      display: flex;
      align-items: center;
      gap: var(--cog-space-100);
    }

    .account-billing__label {
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-body-sm);
    }

    .account-billing__balance,
    .account-billing__note {
      margin: 0;
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-body-sm);
      line-height: var(--cog-lh-body-sm);
    }

    .account-billing__actions {
      display: flex;
      gap: var(--cog-space-100);
    }
  `,
})
export class AccountBillingComponent {
  public readonly billing = inject(BillingService);

  protected planLabel(): string {
    switch (this.billing.planType()) {
      case 'trial':
        return 'Trial';
      case 'payg':
        return 'Pay-As-You-Go';
      case 'unlimited':
        return 'Unlimited';
      case 'inactive':
        return 'No active plan';
      default:
        return 'Unknown';
    }
  }

  protected planTone(): 'blue' | 'green' | 'neutral' {
    switch (this.billing.planType()) {
      case 'trial':
        return 'blue';
      case 'payg':
      case 'unlimited':
        return 'green';
      default:
        return 'neutral';
    }
  }

  protected choosePlan(): void {
    this.billing.openPlanGate('inactive');
  }
}
