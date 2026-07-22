import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';

import {
  CognosButtonComponent,
  CognosSectionMessageComponent,
} from '@cognos/ui-angular';

import { BillingService } from '@app/services/billing.service';

// BillingPaygSoftAlertBannerComponent is the one-per-cycle heads-up when a
// PAYG Account's usage reaches the monthly minimum (OP-014). Calm warning
// only — Completions stay open; "Got it" acknowledges for this cycle.
@Component({
  selector: 'app-billing-payg-soft-alert-banner',
  standalone: true,
  imports: [CognosSectionMessageComponent, CognosButtonComponent, TranslocoModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
      @if (alert(); as alert) {
        <cog-section-message
          tone="info"
          icon="triangle-alert"
          [title]="t('billing.paygSoftAlert.title')"
          data-testid="payg-soft-alert"
        >
          {{ t('billing.paygSoftAlert.body', { min: chf(alert.min_commit_chf) }) }}
          <cog-button
            cogSectionMessageAction
            appearance="primary"
            [disabled]="acknowledging()"
            (click)="acknowledge()"
          >
            {{ t('billing.paygSoftAlert.gotIt') }}
          </cog-button>
        </cog-section-message>
      }
    </ng-container>
  `,
  styles: `
    :host {
      display: block;
    }
  `,
})
export class BillingPaygSoftAlertBannerComponent {
  private readonly _billing = inject(BillingService);
  protected readonly acknowledging = signal(false);

  protected readonly alert = computed(() => {
    const soft = this._billing.paygSoftAlert();
    return soft?.show ? soft : null;
  });

  protected chf(amount: number): string {
    return `CHF ${amount.toFixed(2)}`;
  }

  protected acknowledge(): void {
    if (this.acknowledging()) {
      return;
    }
    this.acknowledging.set(true);
    this._billing.ackPaygSoftAlert();
  }
}
