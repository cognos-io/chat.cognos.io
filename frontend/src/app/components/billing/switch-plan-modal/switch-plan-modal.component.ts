import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  input,
  linkedSignal,
  output,
} from '@angular/core';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';

import {
  CognosButtonComponent,
  CognosIconComponent,
  CognosLozengeComponent,
  CognosModalComponent,
} from '@cognos/ui-angular';

import { BILLING_PRICES } from '@app/billing/pricing';
import { BillingPlanType, CheckoutPlan } from '@app/interfaces/billing';

type BillingPeriod = 'monthly' | 'yearly';

// SwitchPlanModalComponent is the plan-switcher dialog opened from the billing
// dashboard. It shows both plans (marking the one the user is on), a
// monthly/yearly toggle that re-prices Unlimited, and emits the chosen
// CheckoutPlan key for the dashboard to send to change-plan.
@Component({
  selector: 'app-switch-plan-modal',
  standalone: true,
  imports: [
    CognosModalComponent,
    CognosButtonComponent,
    CognosLozengeComponent,
    CognosIconComponent,
    TranslocoModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './switch-plan-modal.component.html',
  styleUrl: './switch-plan-modal.component.scss',
})
export class SwitchPlanModalComponent {
  private readonly _transloco = inject(TranslocoService);

  readonly open = input(false);
  readonly currentPlan = input<BillingPlanType | null>(null);
  readonly currentInterval = input<'monthly' | 'annual' | undefined>(undefined);
  readonly pending = input(false);

  readonly closed = output<void>();
  readonly switchPlan = output<CheckoutPlan>();

  // Defaults to the user's current interval (so an annual subscriber opens on
  // Yearly); a manual toggle overrides until the inputs change.
  protected readonly billingPeriod = linkedSignal<BillingPeriod>(() =>
    this.currentInterval() === 'annual' ? 'yearly' : 'monthly',
  );

  protected setPeriod(period: BillingPeriod): void {
    this.billingPeriod.set(period);
  }

  protected readonly paygIsCurrent = computed(() => this.currentPlan() === 'payg');
  protected readonly prices = BILLING_PRICES;

  // Which Unlimited price the toggle currently targets.
  protected readonly unlimitedTarget = computed<CheckoutPlan>(() =>
    this.billingPeriod() === 'yearly' ? 'unlimited_annual' : 'unlimited_monthly',
  );

  protected readonly unlimitedIsCurrent = computed(() => {
    if (this.currentPlan() !== 'unlimited') {
      return false;
    }
    const currentPeriod = this.currentInterval() === 'annual' ? 'yearly' : 'monthly';
    return currentPeriod === this.billingPeriod();
  });

  protected readonly unlimitedPrice = computed(() =>
    this.billingPeriod() === 'yearly'
      ? BILLING_PRICES.unlimitedAnnual
      : BILLING_PRICES.unlimitedMonthly,
  );

  protected readonly unlimitedPer = computed(() =>
    this.billingPeriod() === 'yearly'
      ? this._transloco.translate('billing.switch.perYear')
      : this._transloco.translate('billing.switch.perMonth'),
  );

  protected readonly unlimitedSub = computed(() =>
    this.billingPeriod() === 'yearly'
      ? this._transloco.translate('billing.switch.unlimitedSubYearly')
      : this._transloco.translate('billing.switch.unlimitedSubMonthly', {
          yearly: BILLING_PRICES.unlimitedAnnual,
          saving: BILLING_PRICES.unlimitedAnnualSaving,
        }),
  );

  protected onClose(): void {
    this.closed.emit();
  }

  protected choosePayg(): void {
    this.switchPlan.emit('payg');
  }

  protected chooseUnlimited(): void {
    this.switchPlan.emit(this.unlimitedTarget());
  }
}
