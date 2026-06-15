import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';

import {
  CognosButtonComponent,
  CognosSectionMessageComponent,
} from '@cognos/ui-angular';

import { BillingService } from '@app/services/billing.service';

// BillingLockBannerComponent is the in-chat notice shown at the top of a
// conversation once sending is locked (trial spent or plan inactive). It keeps
// the reassurance that history stays readable and points to the pricing page.
@Component({
  selector: 'app-billing-lock-banner',
  standalone: true,
  imports: [CognosSectionMessageComponent, CognosButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <cog-section-message tone="info" icon="lock" [title]="title()">
      {{ body() }}
      <cog-button cogSectionMessageAction appearance="primary" (click)="goToBilling()">
        Choose a plan
      </cog-button>
    </cog-section-message>
  `,
  styles: `
    :host {
      display: block;
    }
  `,
})
export class BillingLockBannerComponent {
  private readonly _router = inject(Router);
  public readonly billing = inject(BillingService);

  protected readonly title = computed(() =>
    this.billing.isTrialUsedUp()
      ? 'Your trial credits are used up'
      : 'Your plan is inactive',
  );

  protected readonly body = computed(
    () =>
      'Your chats stay encrypted and readable. Choose a plan to start sending again.',
  );

  protected goToBilling(): void {
    void this._router.navigate(['/account/billing']);
  }
}
