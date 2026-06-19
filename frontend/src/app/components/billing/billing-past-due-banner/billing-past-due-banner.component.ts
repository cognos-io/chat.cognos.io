import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';

import {
  CognosButtonComponent,
  CognosSectionMessageComponent,
} from '@cognos/ui-angular';

import { BillingService } from '@app/services/billing.service';

// BillingPastDueBannerComponent warns a subscriber whose last renewal payment
// failed. Access continues through Paddle's dunning window, so this is a
// warning (not a lock) and points straight at the card-update form.
@Component({
  selector: 'app-billing-past-due-banner',
  standalone: true,
  imports: [CognosSectionMessageComponent, CognosButtonComponent, TranslocoModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
      <cog-section-message
        tone="info"
        icon="triangle-alert"
        [title]="t('billing.pastDue.title')"
      >
        {{ t('billing.pastDue.body') }}
        <cog-button cogSectionMessageAction appearance="primary" (click)="updateCard()">
          {{ t('billing.pastDue.updateCard') }}
        </cog-button>
      </cog-section-message>
    </ng-container>
  `,
  styles: `
    :host {
      display: block;
    }
  `,
})
export class BillingPastDueBannerComponent {
  public readonly billing = inject(BillingService);

  protected updateCard(): void {
    this.billing.openPortal('payment');
  }
}
