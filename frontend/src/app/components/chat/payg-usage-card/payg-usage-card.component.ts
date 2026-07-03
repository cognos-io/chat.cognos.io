import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';

import { CognosButtonComponent, CognosIconComponent } from '@cognos/ui-angular';

import { BillingService } from '@app/services/billing.service';

// PaygUsageCardComponent shows pay-as-you-go users their running cost for the
// current cycle. PAYG has no prepaid credit: the monthly bill is
// max(usage, minimum), so below the minimum we explain that usage is covered
// by it, and above we show the overage that Paddle adds to the next invoice
// automatically. Never a nudge or a lock. Rendered only for the PAYG plan.
@Component({
  selector: 'app-payg-usage-card',
  standalone: true,
  imports: [CognosButtonComponent, CognosIconComponent, TranslocoModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="payg-usage" *transloco="let t">
      <header class="payg-usage__head">
        <span class="payg-usage__label">
          <cog-icon name="credit-card" [size]="16" tone="brand" />
          {{ t('chat.payg.title') }}
        </span>
        @if (usage() !== null) {
          <span class="payg-usage__amount">{{ chf(usage()!) }}</span>
        }
      </header>

      <p class="payg-usage__detail">
        @if (overage() > 0) {
          {{
            t('chat.payg.overMinimum', {
              overage: chf(overage()),
              min: chf(minimum()),
            })
          }}
        } @else {
          {{ t('chat.payg.underMinimum', { min: chf(minimum()) }) }}
        }
      </p>

      <cog-button appearance="subtle" [fullWidth]="true" (click)="goToBilling()">
        {{ t('chat.payg.manage') }}
      </cog-button>
    </section>
  `,
  styles: `
    :host {
      display: block;
    }

    .payg-usage {
      display: grid;
      gap: var(--cog-space-100);
      border: 1px solid var(--cog-border);
      border-radius: var(--cog-radius-md);
      background: var(--cog-surface);
      padding: var(--cog-space-150);
    }

    .payg-usage__head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--cog-space-100);
    }

    .payg-usage__label {
      display: inline-flex;
      align-items: center;
      gap: var(--cog-space-050);
      color: var(--cog-text);
      font-weight: var(--cog-fw-semibold);
      font-size: var(--cog-fs-body-sm);
    }

    .payg-usage__amount {
      color: var(--cog-text);
      font-weight: var(--cog-fw-semibold);
      font-size: var(--cog-fs-body-sm);
      font-variant-numeric: tabular-nums;
    }

    .payg-usage__detail {
      margin: 0;
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-caption);
      line-height: var(--cog-lh-caption);
    }
  `,
})
export class PaygUsageCardComponent {
  private readonly _router = inject(Router);
  public readonly billing = inject(BillingService);

  protected readonly usage = computed(() => this.billing.paygUsageChf());
  protected readonly minimum = computed(() => this.billing.paygMinCommitChf());
  protected readonly overage = computed(() => this.billing.paygOverageChf());

  protected chf(amount: number): string {
    return `CHF ${amount.toFixed(2)}`;
  }

  protected goToBilling(): void {
    void this._router.navigate(['/account/billing']);
  }
}
