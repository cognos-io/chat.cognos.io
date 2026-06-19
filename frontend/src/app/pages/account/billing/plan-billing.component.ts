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

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';

import {
  CognosBreadcrumbsComponent,
  CognosButtonComponent,
  CognosIconComponent,
  CognosLozengeComponent,
  CognosProgressComponent,
} from '@cognos/ui-angular';

import { BillingPastDueBannerComponent } from '@app/components/billing/billing-past-due-banner/billing-past-due-banner.component';
import { SwitchPlanModalComponent } from '@app/components/billing/switch-plan-modal/switch-plan-modal.component';
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
    SwitchPlanModalComponent,
    TranslocoModule,
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
  private readonly _transloco = inject(TranslocoService);

  protected readonly billing = signal<BillingApiResponse | null>(null);
  protected readonly usage = signal<UsageResponse | null>(null);
  protected readonly invoiceData = signal<BillingInvoicesResponse | null>(null);
  protected readonly actionPending = signal(false);
  // Whether the "Switch plan" picker is open (active/cancels-soon subscribers).
  protected readonly switchOpen = signal(false);

  protected readonly breadcrumbs = computed(() => [
    { label: 'Cognos' },
    { label: this._transloco.translate('billing.plan.breadcrumbs.settings') },
    {
      label: this._transloco.translate('billing.plan.breadcrumbs.planBilling'),
      current: true,
    },
  ]);

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
      labels[brand] ??
      (brand
        ? brand.charAt(0).toUpperCase() + brand.slice(1)
        : this._transloco.translate('billing.plan.payment.card'))
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
        return {
          text: this._transloco.translate('billing.plan.invoiceStatus.paid'),
          tone: 'green',
        };
      case 'refunded':
        return {
          text: this._transloco.translate('billing.plan.invoiceStatus.refunded'),
          tone: 'red',
        };
      case 'past_due':
        return {
          text: this._transloco.translate('billing.plan.invoiceStatus.pastDue'),
          tone: 'red',
        };
      case 'billed':
        return {
          text: this._transloco.translate('billing.plan.invoiceStatus.due'),
          tone: 'blue',
        };
      default:
        return {
          text: this._transloco.translate('billing.plan.invoiceStatus.pending'),
          tone: 'neutral',
        };
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
    this.status() === 'inactive'
      ? this._transloco.translate('billing.plan.heading.previous')
      : this._transloco.translate('billing.plan.heading.current'),
  );

  protected readonly badge = computed<{
    text: string;
    tone: 'green' | 'blue' | 'neutral' | 'red';
  }>(() => {
    switch (this.status()) {
      case 'active':
        return {
          text: this._transloco.translate('billing.plan.statusBadge.active'),
          tone: 'green',
        };
      case 'past_due':
        return {
          text: this._transloco.translate('billing.plan.statusBadge.paymentFailed'),
          tone: 'red',
        };
      case 'cancels_soon':
        return {
          text: this._transloco.translate('billing.plan.statusBadge.cancelsSoon'),
          tone: 'neutral',
        };
      case 'trial':
        return {
          text: this._transloco.translate('billing.plan.statusBadge.trial'),
          tone: 'blue',
        };
      default:
        return {
          text: this._transloco.translate('billing.plan.statusBadge.readOnly'),
          tone: 'neutral',
        };
    }
  });

  // A failed renewal payment — drives the dashboard banner + "Update card" CTA.
  protected readonly isPastDue = computed(() => this.status() === 'past_due');

  // Set once the user has sent a refund request this session (stub flow).
  protected readonly refundRequested = signal(false);

  // requestRefund sends the v0 refund request (operator-driven; spec §12.5). It
  // does not issue a refund — it flags the request for follow-up.
  protected requestRefund(): void {
    if (this.actionPending()) {
      return;
    }
    this.actionPending.set(true);
    this._api
      .requestRefund('')
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({
        next: () => {
          this.actionPending.set(false);
          this.refundRequested.set(true);
        },
        error: () => {
          this.actionPending.set(false);
          this._errors.alert(this._transloco.translate('billing.toasts.refundError'));
        },
      });
  }

  protected readonly planName = computed(() => {
    const billing = this.billing();
    if (!billing) {
      return '—';
    }
    const plan =
      billing.status === 'inactive' ? billing.previous_plan_type : billing.plan_type;
    switch (plan) {
      case 'unlimited':
        return this._transloco.translate('billing.plan.names.unlimited');
      case 'payg':
        return this._transloco.translate('billing.plan.names.payg');
      case 'trial':
        return this._transloco.translate('billing.plan.names.trial');
      default:
        return this._transloco.translate('billing.plan.names.none');
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
      return billing.interval === 'annual'
        ? this._transloco.translate('billing.plan.price.perYear', {
            price: "CHF 1'000",
          })
        : this._transloco.translate('billing.plan.price.perMonth', {
            price: 'CHF 100',
          });
    }
    if (billing.plan_type === 'payg' || billing.previous_plan_type === 'payg') {
      return this._transloco.translate('billing.plan.price.perMonthMin', {
        price: 'CHF 10',
      });
    }
    return '';
  });

  protected readonly blurb = computed(() => {
    switch (this.status()) {
      case 'cancels_soon':
        return this._transloco.translate('billing.plan.blurb.cancelsSoon');
      case 'inactive':
        return this._transloco.translate('billing.plan.blurb.inactive');
      case 'trial':
        return this._transloco.translate('billing.plan.blurb.trial');
      default:
        return this.isPayg()
          ? this._transloco.translate('billing.plan.blurb.payg')
          : this._transloco.translate('billing.plan.blurb.unlimited');
    }
  });

  protected readonly dateHeading = computed(() => {
    switch (this.status()) {
      case 'cancels_soon':
        return this._transloco.translate('billing.plan.dateHeading.accessUntil');
      case 'inactive':
        return this._transloco.translate('billing.plan.dateHeading.ended');
      case 'past_due':
        return this._transloco.translate('billing.plan.dateHeading.retrying');
      case 'active':
        return this.isPayg()
          ? this._transloco.translate('billing.plan.dateHeading.nextMinCharge')
          : this._transloco.translate('billing.plan.dateHeading.renews');
      default:
        return this._transloco.translate('billing.plan.dateHeading.trial');
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
          this._errors.alert(this._transloco.translate('billing.toasts.switchError'));
        },
      });
  }

  // Open the Paddle customer portal in a new tab — 'payment' deep-links to the
  // card form, 'overview' lands on invoices + receipts.
  protected openPortal(target: 'overview' | 'payment'): void {
    this._billing.openPortal(target);
  }

  // Open a single invoice's PDF (ownership-checked server-side) in a new tab.
  protected downloadInvoice(transactionId: string): void {
    this._billing.openInvoicePdf(transactionId);
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
        this._errors.alert(this._transloco.translate('billing.toasts.genericError'));
      },
    });
  }
}
