import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';

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
  imports: [CognosSectionMessageComponent, CognosButtonComponent, TranslocoModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
      <cog-section-message tone="info" icon="lock" [title]="title()">
        {{ body() }}
        <cog-button
          cogSectionMessageAction
          appearance="primary"
          (click)="goToBilling()"
        >
          {{ t('billing.lock.choosePlan') }}
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
export class BillingLockBannerComponent {
  private readonly _router = inject(Router);
  private readonly _transloco = inject(TranslocoService);
  public readonly billing = inject(BillingService);

  protected readonly title = computed(() =>
    this.billing.isTrialUsedUp()
      ? this._transloco.translate('billing.lock.titleTrialUsedUp')
      : this._transloco.translate('billing.lock.titleInactive'),
  );

  protected readonly body = computed(() =>
    this._transloco.translate('billing.lock.body'),
  );

  protected goToBilling(): void {
    void this._router.navigate(['/pricing']);
  }
}
