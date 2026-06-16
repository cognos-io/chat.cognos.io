import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

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
  imports: [CognosSectionMessageComponent, CognosButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <cog-section-message
      tone="info"
      icon="triangle-alert"
      title="We couldn't take your last payment"
    >
      Update your card to keep your plan — your access continues for now.
      <cog-button cogSectionMessageAction appearance="primary" (click)="updateCard()">
        Update card
      </cog-button>
    </cog-section-message>
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
