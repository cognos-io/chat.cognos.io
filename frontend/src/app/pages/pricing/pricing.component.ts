import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute, RouterLink } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';

import {
  CognosButtonComponent,
  CognosIconComponent,
  CognosLozengeComponent,
} from '@cognos/ui-angular';

import { BILLING_PRICES } from '@app/billing/pricing';
import { CheckoutPlan } from '@app/interfaces/billing';
import { BillingService } from '@app/services/billing.service';

type BillingInterval = 'monthly' | 'yearly';

// AccountBillingComponent is the pricing / "keep going" page. It is where every
// locked-chat surface points. Plan CTAs start a Paddle checkout via
// BillingService (Paddle.js overlay, or a hosted-checkout redirect fallback).
// The activation poll — shared with overlay completion — lives in the service;
// ?status=activating (set on the redirect return) kicks it off here.
@Component({
  selector: 'app-pricing',
  standalone: true,
  imports: [
    RouterLink,
    CognosButtonComponent,
    CognosIconComponent,
    CognosLozengeComponent,
    TranslocoModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="pricing" *transloco="let t">
      <a class="pricing__back" routerLink="/">
        <cog-icon name="chevron-left" [size]="16" tone="current" />
        {{ t('billing.pricing.back') }}
      </a>

      @if (billing.activating()) {
        <section class="pricing__activating" role="status">
          <cog-icon name="loader" [size]="28" tone="brand" />
          <h1 class="pricing__title">{{ t('billing.pricing.activating.title') }}</h1>
          @if (billing.activationSlow()) {
            <p class="pricing__subtitle">
              {{ t('billing.pricing.activating.slow') }}
            </p>
          } @else {
            <p class="pricing__subtitle">
              {{ t('billing.pricing.activating.normal') }}
            </p>
          }
        </section>
      } @else {
        <header class="pricing__intro">
          @if (billing.isSendingLocked()) {
            <span class="pricing__status">
              <cog-icon name="lock" [size]="14" tone="text-subtle" />
              {{
                billing.isTrialUsedUp()
                  ? t('billing.pricing.status.trialUsedUp')
                  : t('billing.pricing.status.sendingPaused')
              }}
            </span>
          }

          <h1 class="pricing__title">{{ t('billing.pricing.title') }}</h1>
          <p class="pricing__subtitle">
            {{ t('billing.pricing.subtitle') }}
          </p>

          <div
            class="pricing__interval"
            role="group"
            [attr.aria-label]="t('billing.pricing.intervalAria')"
          >
            <button
              type="button"
              class="pricing__interval-option"
              [class.pricing__interval-option--active]="interval() === 'monthly'"
              [attr.aria-pressed]="interval() === 'monthly'"
              (click)="interval.set('monthly')"
            >
              {{ t('billing.pricing.monthly') }}
            </button>
            <button
              type="button"
              class="pricing__interval-option"
              [class.pricing__interval-option--active]="interval() === 'yearly'"
              [attr.aria-pressed]="interval() === 'yearly'"
              (click)="interval.set('yearly')"
            >
              {{ t('billing.pricing.yearly') }}
              <cog-lozenge tone="green">{{
                t('billing.pricing.monthsFree')
              }}</cog-lozenge>
            </button>
          </div>
        </header>

        <div class="pricing__plans">
          <!-- Pay as you go -->
          <section class="pricing__card">
            <div class="pricing__card-head">
              <h2 class="pricing__plan-name">{{ t('billing.pricing.payg.name') }}</h2>
              <cog-lozenge tone="blue">{{ t('billing.pricing.payg.tag') }}</cog-lozenge>
            </div>
            <p class="pricing__plan-blurb">
              {{ t('billing.pricing.payg.blurb') }}
            </p>

            <p class="pricing__price">
              <span class="pricing__price-amount">{{ prices.paygMinimum }}</span>
              <span class="pricing__price-unit">{{
                t('billing.pricing.payg.unit')
              }}</span>
            </p>
            <p class="pricing__price-note">{{ t('billing.pricing.payg.priceNote') }}</p>

            <cog-button
              appearance="default"
              [fullWidth]="true"
              [disabled]="checkoutPending()"
              (click)="selectPlan('payg')"
            >
              {{ t('billing.pricing.payg.cta') }}
            </cog-button>

            <ul class="pricing__features">
              @for (feature of paygFeatures; track feature.key) {
                <li [class.pricing__feature--muted]="feature.muted">
                  <cog-icon
                    name="check"
                    [size]="16"
                    [tone]="feature.muted ? 'text-subtlest' : 'success'"
                  />
                  {{ t(feature.key) }}
                </li>
              }
            </ul>

            <p class="pricing__fine">
              {{ t('billing.pricing.payg.fine') }}
            </p>
          </section>

          <!-- Unlimited -->
          <section class="pricing__card pricing__card--featured">
            <div class="pricing__card-head">
              <h2 class="pricing__plan-name">
                {{ t('billing.pricing.unlimited.name') }}
              </h2>
              <cog-lozenge tone="green">{{
                t('billing.pricing.unlimited.tag')
              }}</cog-lozenge>
            </div>
            <p class="pricing__plan-blurb">
              {{ t('billing.pricing.unlimited.blurb') }}
            </p>

            @if (interval() === 'monthly') {
              <p class="pricing__price">
                <span class="pricing__price-amount">{{ prices.unlimitedMonthly }}</span>
                <span class="pricing__price-unit">{{
                  t('billing.pricing.unlimited.perMonth')
                }}</span>
              </p>
              <p class="pricing__price-note pricing__price-note--accent">
                {{
                  t('billing.pricing.unlimited.savesMonthly', {
                    yearly: prices.unlimitedAnnual,
                    saving: prices.unlimitedAnnualSaving,
                  })
                }}
              </p>
            } @else {
              <p class="pricing__price">
                <span class="pricing__price-amount">{{ prices.unlimitedAnnual }}</span>
                <span class="pricing__price-unit">{{
                  t('billing.pricing.unlimited.perYear')
                }}</span>
              </p>
              <p class="pricing__price-note pricing__price-note--accent">
                {{ t('billing.pricing.unlimited.savesYearly') }}
              </p>
            }

            <cog-button
              appearance="primary"
              [fullWidth]="true"
              [disabled]="checkoutPending()"
              (click)="selectPlan('unlimited')"
            >
              {{ t('billing.pricing.unlimited.cta') }}
            </cog-button>

            <ul class="pricing__features">
              @for (feature of unlimitedFeatures; track feature) {
                <li>
                  <cog-icon name="check" [size]="16" tone="success" />
                  {{ t(feature) }}
                </li>
              }
            </ul>

            <p class="pricing__fine">
              <cog-icon name="info" [size]="14" tone="text-subtlest" />
              {{ t('billing.pricing.unlimited.fine') }}
            </p>
          </section>
        </div>

        <section class="pricing__guarantee">
          <span class="pricing__guarantee-icon">
            <cog-icon name="shield-check" [size]="20" tone="success" />
          </span>
          <div>
            <div class="pricing__guarantee-title">
              {{ t('billing.pricing.guarantee.title') }}
            </div>
            <p class="pricing__guarantee-body">
              {{ t('billing.pricing.guarantee.body') }}
            </p>
          </div>
        </section>

        <div class="pricing__assurances">
          <div class="pricing__assurance">
            <cog-icon name="file-text" [size]="18" tone="text-subtle" />
            <div>
              <div class="pricing__assurance-title">
                {{ t('billing.pricing.assurances.readable.title') }}
              </div>
              <p>{{ t('billing.pricing.assurances.readable.body') }}</p>
            </div>
          </div>
          <div class="pricing__assurance">
            <cog-icon name="key-round" [size]="18" tone="text-subtle" />
            <div>
              <div class="pricing__assurance-title">
                {{ t('billing.pricing.assurances.encrypted.title') }}
              </div>
              <p>{{ t('billing.pricing.assurances.encrypted.body') }}</p>
            </div>
          </div>
          <div class="pricing__assurance">
            <cog-icon name="x" [size]="18" tone="text-subtle" />
            <div>
              <div class="pricing__assurance-title">
                {{ t('billing.pricing.assurances.noLockIn.title') }}
              </div>
              <p>{{ t('billing.pricing.assurances.noLockIn.body') }}</p>
            </div>
          </div>
        </div>

        <p class="pricing__footer">
          {{ t('billing.pricing.footer.text') }}
          <a href="mailto:support@cognos.io" class="pricing__link">{{
            t('billing.pricing.footer.link')
          }}</a
          >.
        </p>
      }
    </main>
  `,
  styleUrl: './pricing.component.scss',
})
export class PricingComponent {
  private readonly _route = inject(ActivatedRoute);
  public readonly billing = inject(BillingService);

  readonly interval = signal<BillingInterval>('monthly');
  protected readonly prices = BILLING_PRICES;

  constructor() {
    // On the redirect return from a hosted checkout, kick off the shared poll.
    if (this._route.snapshot.queryParamMap.get('status') === 'activating') {
      this.billing.pollActivation();
    }
  }

  protected readonly paygFeatures = [
    { key: 'billing.pricing.payg.features.credits', muted: false },
    { key: 'billing.pricing.payg.features.payForUse', muted: false },
    { key: 'billing.pricing.payg.features.rollover', muted: false },
    { key: 'billing.pricing.payg.features.noCommitment', muted: true },
  ];

  protected readonly unlimitedFeatures = [
    'billing.pricing.unlimited.features.unlimited',
    'billing.pricing.unlimited.features.priority',
    'billing.pricing.unlimited.features.skills',
    'billing.pricing.unlimited.features.cancel',
  ];

  // Whether the user is currently locked (used by the locked-state pill).
  protected readonly locked = computed(() => this.billing.isSendingLocked());
  protected readonly checkoutPending = this.billing.checkoutPending;

  // Maps a card + the interval toggle to the Paddle checkout plan key, then
  // hands off to the service (which redirects to Paddle).
  protected selectPlan(card: 'payg' | 'unlimited'): void {
    const plan: CheckoutPlan =
      card === 'payg'
        ? 'payg'
        : this.interval() === 'yearly'
          ? 'unlimited_annual'
          : 'unlimited_monthly';
    this.billing.beginCheckout(plan);
  }
}
