import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';

import {
  CognosButtonComponent,
  CognosIconComponent,
  CognosLozengeComponent,
} from '@cognos/ui-angular';

import { BillingService } from '@app/services/billing.service';

// PaygBalanceCardComponent gives pay-as-you-go users the balance visibility the
// trial credit card gives trial users. It shows the remaining prepaid credit
// and, when it runs low, a calm nudge to top up (never a lock — PAYG keeps
// working via overage). Rendered only for the PAYG plan.
@Component({
  selector: 'app-payg-balance-card',
  standalone: true,
  imports: [
    CognosButtonComponent,
    CognosIconComponent,
    CognosLozengeComponent,
    TranslocoModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="payg-balance" *transloco="let t">
      <header class="payg-balance__head">
        <span class="payg-balance__label">
          <cog-icon name="credit-card" [size]="16" tone="brand" />
          {{ t('chat.payg.balanceLabel') }}
        </span>
        @if (low()) {
          <cog-lozenge tone="red">{{ t('chat.payg.low') }}</cog-lozenge>
        }
      </header>

      <p class="payg-balance__detail">
        {{ t('chat.payg.detail', { amount: 'CHF ' + balance().toFixed(2) }) }}
      </p>

      @if (low()) {
        <p class="payg-balance__warning" role="status">
          {{ t('chat.payg.lowWarning') }}
        </p>
        <cog-button
          appearance="primary"
          icon="chevron-right"
          [fullWidth]="true"
          (click)="goToBilling()"
        >
          {{ t('chat.payg.manage') }}
        </cog-button>
      }
    </section>
  `,
  styles: `
    :host {
      display: block;
    }

    .payg-balance {
      display: grid;
      gap: var(--cog-space-100);
      border: 1px solid var(--cog-border);
      border-radius: var(--cog-radius-md);
      background: var(--cog-surface);
      padding: var(--cog-space-150);
    }

    .payg-balance__head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--cog-space-100);
    }

    .payg-balance__label {
      display: inline-flex;
      align-items: center;
      gap: var(--cog-space-050);
      color: var(--cog-text);
      font-weight: var(--cog-fw-semibold);
      font-size: var(--cog-fs-body-sm);
    }

    .payg-balance__detail {
      margin: 0;
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-caption);
      line-height: var(--cog-lh-caption);
    }

    .payg-balance__warning {
      margin: 0;
      color: var(--cog-danger-text);
      font-size: var(--cog-fs-caption);
      line-height: var(--cog-lh-caption);
    }
  `,
})
export class PaygBalanceCardComponent {
  private readonly _router = inject(Router);
  public readonly billing = inject(BillingService);

  protected readonly balance = computed(() => Math.max(0, this.billing.balanceChf()));
  protected readonly low = computed(() => this.billing.isPaygBalanceLow());

  protected goToBilling(): void {
    void this._router.navigate(['/account/billing']);
  }
}
