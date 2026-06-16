import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Router } from '@angular/router';

import {
  CognosBreadcrumbsComponent,
  CognosButtonComponent,
  CognosIconComponent,
  CognosLozengeComponent,
  CognosProgressComponent,
} from '@cognos/ui-angular';

import { BillingPastDueBannerComponent } from '@app/components/billing/billing-past-due-banner/billing-past-due-banner.component';
import { PaddleLogoComponent } from '@app/components/paddle-logo/paddle-logo.component';
import {
  BillingApiResponse,
  BillingInvoicesResponse,
  CheckoutPlan,
  Invoice,
  PaymentCard,
  UsageResponse,
} from '@app/interfaces/billing';
import { BillingService } from '@app/services/billing.service';
import { CognosApiService } from '@app/services/cognos-api.service';
import { ErrorService } from '@app/services/error.service';
import { ModelService } from '@app/services/model.service';

interface UsageBar {
  name: string;
  sublabel: string;
  value: number; // count or cost, for the bar width
  display: string; // formatted figure shown on the right
}

@Component({
  selector: 'app-plan-billing',
  standalone: true,
  imports: [
    DatePipe,
    CognosBreadcrumbsComponent,
    CognosButtonComponent,
    CognosIconComponent,
    CognosLozengeComponent,
    CognosProgressComponent,
    PaddleLogoComponent,
    BillingPastDueBannerComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  templateUrl: './plan-billing.component.html',
  styleUrl: './plan-billing.component.scss',
})
export class PlanBillingComponent {
  private readonly _api = inject(CognosApiService);
  private readonly _router = inject(Router);
  private readonly _models = inject(ModelService);
  private readonly _billing = inject(BillingService);
  private readonly _errors = inject(ErrorService);
  private readonly _destroyRef = inject(DestroyRef);

  protected readonly billing = signal<BillingApiResponse | null>(null);
  protected readonly usage = signal<UsageResponse | null>(null);
  protected readonly invoiceData = signal<BillingInvoicesResponse | null>(null);
  protected readonly actionPending = signal(false);
  // Whether the "Switch plan" picker is open (active/cancels-soon subscribers).
  protected readonly switchOpen = signal(false);

  protected readonly breadcrumbs = [
    { label: 'Cognos' },
    { label: 'Settings' },
    { label: 'Plan & billing', current: true },
  ];

  protected onBreadcrumb(index: number): void {
    if (index === 0) {
      void this._router.navigate(['/']);
    }
  }

  constructor() {
    this.load();
  }

  private load(): void {
    this._api
      .getBilling()
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({ next: (res) => this.billing.set(res), error: () => undefined });
    this._api
      .getBillingUsage()
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({ next: (res) => this.usage.set(res), error: () => undefined });
    this._api
      .getBillingInvoices()
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({ next: (res) => this.invoiceData.set(res), error: () => undefined });
  }

  // --- Card + invoices -----------------------------------------------------

  protected readonly card = computed<PaymentCard | null>(
    () => this.invoiceData()?.card ?? null,
  );
  protected readonly invoices = computed<Invoice[]>(
    () => this.invoiceData()?.invoices ?? [],
  );

  protected cardBrandLabel(brand: string): string {
    const labels: Record<string, string> = {
      visa: 'Visa',
      mastercard: 'Mastercard',
      american_express: 'Amex',
      amex: 'Amex',
    };
    return (
      labels[brand] ?? (brand ? brand.charAt(0).toUpperCase() + brand.slice(1) : 'Card')
    );
  }

  protected cardExpiry(card: PaymentCard): string {
    return `${String(card.expiry_month).padStart(2, '0')} / ${card.expiry_year}`;
  }

  protected invoiceAmount(invoice: Invoice): string {
    return `${invoice.currency} ${(invoice.amount_minor / 100).toFixed(2)}`;
  }

  protected invoiceBadge(status: string): {
    text: string;
    tone: 'green' | 'red' | 'blue' | 'neutral';
  } {
    switch (status) {
      case 'paid':
      case 'completed':
        return { text: 'Paid', tone: 'green' };
      case 'past_due':
        return { text: 'Past due', tone: 'red' };
      case 'billed':
        return { text: 'Due', tone: 'blue' };
      default:
        return { text: 'Pending', tone: 'neutral' };
    }
  }

  // --- Derived view state -------------------------------------------------

  protected readonly status = computed(() => this.billing()?.status ?? 'inactive');

  // A Paddle customer only exists once the user has checked out, so the portal
  // (manage card / invoices) is only reachable off the trial.
  protected readonly hasBillingAccount = computed(() => this.status() !== 'trial');
  protected readonly isPayg = computed(
    () =>
      this.billing()?.plan_type === 'payg' ||
      this.billing()?.previous_plan_type === 'payg',
  );

  // The money-back guarantee only applies within the refund window, so hide it
  // once it has lapsed (or when the backend set no eligibility date).
  protected readonly refundEligible = computed(() => {
    const until = this.billing()?.refund_eligible_until_at;
    return until ? new Date(until).getTime() > Date.now() : false;
  });

  protected readonly heading = computed(() =>
    this.status() === 'inactive' ? 'Previous plan' : 'Current plan',
  );

  protected readonly badge = computed<{
    text: string;
    tone: 'green' | 'blue' | 'neutral' | 'red';
  }>(() => {
    switch (this.status()) {
      case 'active':
        return { text: 'Active', tone: 'green' };
      case 'past_due':
        return { text: 'Payment failed', tone: 'red' };
      case 'cancels_soon':
        return { text: 'Cancels soon', tone: 'neutral' };
      case 'trial':
        return { text: 'Trial', tone: 'blue' };
      default:
        return { text: 'Read-only', tone: 'neutral' };
    }
  });

  // A failed renewal payment — drives the dashboard banner + "Update card" CTA.
  protected readonly isPastDue = computed(() => this.status() === 'past_due');

  protected readonly planName = computed(() => {
    const billing = this.billing();
    if (!billing) {
      return '—';
    }
    const plan =
      billing.status === 'inactive' ? billing.previous_plan_type : billing.plan_type;
    switch (plan) {
      case 'unlimited':
        return 'Unlimited';
      case 'payg':
        return 'Pay as you go';
      case 'trial':
        return 'Trial';
      default:
        return 'No plan';
    }
  });

  protected readonly priceLabel = computed(() => {
    const billing = this.billing();
    if (!billing) {
      return '';
    }
    if (
      billing.plan_type === 'unlimited' ||
      billing.previous_plan_type === 'unlimited'
    ) {
      return billing.interval === 'annual' ? "CHF 1'000 / year" : 'CHF 100 / month';
    }
    if (billing.plan_type === 'payg' || billing.previous_plan_type === 'payg') {
      return 'CHF 10 / month min.';
    }
    return '';
  });

  protected readonly blurb = computed(() => {
    switch (this.status()) {
      case 'cancels_soon':
        return 'Your plan is set to cancel. It keeps working until the end of the period.';
      case 'inactive':
        return 'Your chats stay encrypted and readable. Choose a plan to start sending again.';
      case 'trial':
        return 'You’re on the free trial. Choose a plan to keep sending once it runs out.';
      default:
        return this.isPayg()
          ? 'Buy credits and spend them on any model. A CHF 10 minimum keeps your account active each month.'
          : 'Unlimited messages across every Cognos model, with priority Swiss-cloud compute.';
    }
  });

  protected readonly dateHeading = computed(() => {
    switch (this.status()) {
      case 'cancels_soon':
        return 'Access until';
      case 'inactive':
        return 'Ended';
      case 'past_due':
        return 'Retrying payment';
      case 'active':
        return this.isPayg() ? 'Next minimum charge' : 'Renews';
      default:
        return 'Trial';
    }
  });

  // Usage rows resolved against the model catalogue. For PAYG we surface spend;
  // otherwise message counts.
  protected readonly usageBars = computed<UsageBar[]>(() => {
    const usage = this.usage();
    if (!usage) {
      return [];
    }
    const payg = this.isPayg();
    const bars = usage.by_model.map((row) => {
      const model = this._models.modelList().find((m) => m.id === row.model_id);
      const value = payg ? row.cost_chf : row.count;
      return {
        name: model?.name ?? row.model_id,
        sublabel: model?.hostingRegion ?? model?.hostingCountry ?? '',
        value,
        display: payg
          ? `CHF ${row.cost_chf.toFixed(2)}`
          : row.count.toLocaleString('en-CH'),
      };
    });
    return bars;
  });

  protected readonly usageMax = computed(() =>
    Math.max(1, ...this.usageBars().map((bar) => bar.value)),
  );

  // Total spend this period (PAYG headline) — billing is token-cost based, so we
  // show francs rather than a message count.
  protected readonly usageTotalCostChf = computed(() =>
    (this.usage()?.by_model ?? []).reduce((sum, row) => sum + row.cost_chf, 0),
  );

  protected barWidth(value: number): number {
    return Math.round((value / this.usageMax()) * 100);
  }

  // --- Actions ------------------------------------------------------------

  protected goToPlans(): void {
    void this._router.navigate(['/pricing']);
  }

  // The plans an active subscriber can switch to, with timing wording. Upgrades
  // to Unlimited take effect immediately (prorated); downgrades and
  // monthly↔annual switches start at the next renewal (no pro-rata) — matching
  // the change-plan backend (spec §3.4).
  protected readonly switchTargets = computed<
    { key: CheckoutPlan; label: string; note: string }[]
  >(() => {
    const billing = this.billing();
    if (!billing) {
      return [];
    }
    const toUnlimitedMonthly = {
      key: 'unlimited_monthly' as CheckoutPlan,
      label: 'Unlimited · monthly — CHF 100 / month',
    };
    const toUnlimitedAnnual = {
      key: 'unlimited_annual' as CheckoutPlan,
      label: "Unlimited · annual — CHF 1'000 / year",
    };
    const toPayg = {
      key: 'payg' as CheckoutPlan,
      label: 'Pay as you go — CHF 10 / month min.',
    };
    const now = 'Takes effect now — prorated to this cycle.';
    const next = 'No charge today — billed at the new rate from your next renewal.';

    switch (billing.plan_type) {
      case 'payg':
        return [
          { ...toUnlimitedMonthly, note: now },
          { ...toUnlimitedAnnual, note: now },
        ];
      case 'unlimited':
        return billing.interval === 'annual'
          ? [
              { ...toUnlimitedMonthly, note: next },
              { ...toPayg, note: next },
            ]
          : [
              { ...toUnlimitedAnnual, note: next },
              { ...toPayg, note: next },
            ];
      default:
        return [];
    }
  });

  protected openSwitch(): void {
    this.switchOpen.set(true);
  }

  protected closeSwitch(): void {
    this.switchOpen.set(false);
  }

  // changeTo switches the existing subscription to the chosen plan. A `checkout`
  // outcome (no live subscription) is handled inside BillingService (overlay);
  // otherwise we reload the dashboard to reflect the new plan.
  protected changeTo(plan: CheckoutPlan): void {
    if (this.actionPending()) {
      return;
    }
    this.actionPending.set(true);
    this._billing
      .changePlan(plan)
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({
        next: (res) => {
          this.actionPending.set(false);
          this.switchOpen.set(false);
          if (res.status !== 'checkout') {
            this.load();
          }
        },
        error: () => {
          this.actionPending.set(false);
          this._errors.alert('Could not switch your plan. Please try again.');
        },
      });
  }

  // Open the Paddle customer portal in a new tab — 'payment' deep-links to the
  // card form, 'overview' lands on invoices + receipts.
  protected openPortal(target: 'overview' | 'payment'): void {
    this._billing.openPortal(target);
  }

  protected cancel(): void {
    this.runAction(this._api.cancelSubscription());
  }

  protected resume(): void {
    this.runAction(this._api.resumeSubscription());
  }

  private runAction(action: ReturnType<CognosApiService['cancelSubscription']>): void {
    if (this.actionPending()) {
      return;
    }
    this.actionPending.set(true);
    action.pipe(takeUntilDestroyed(this._destroyRef)).subscribe({
      next: () => {
        this.actionPending.set(false);
        this._billing.refresh(); // keep the chat shell in sync
        this.load(); // refresh the dashboard
      },
      error: () => {
        this.actionPending.set(false);
        this._errors.alert('Something went wrong. Please try again.');
      },
    });
  }
}
