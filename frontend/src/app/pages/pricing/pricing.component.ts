import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router, RouterLink } from '@angular/router';

import { switchMap, take, timer } from 'rxjs';

import {
  CognosButtonComponent,
  CognosIconComponent,
  CognosLozengeComponent,
} from '@cognos/ui-angular';

import { CheckoutPlan } from '@app/interfaces/billing';
import { BillingService } from '@app/services/billing.service';

type BillingInterval = 'monthly' | 'yearly';

// How long to wait for the subscription.created webhook before telling the user
// it's taking longer than usual. ~100s at a cache-warm 2.5s cadence.
const ACTIVATION_POLL_INTERVAL_MS = 2500;
const ACTIVATION_POLL_MAX_ATTEMPTS = 40;

// AccountBillingComponent is the pricing / "keep going" page. It is where every
// locked-chat surface points. Plan CTAs start a Paddle checkout via
// BillingService; after the redirect back, ?status=activating drives the poll
// that waits for the subscription webhook before returning the user to chat.
@Component({
  selector: 'app-pricing',
  standalone: true,
  imports: [
    RouterLink,
    CognosButtonComponent,
    CognosIconComponent,
    CognosLozengeComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="pricing">
      <a class="pricing__back" routerLink="/">
        <cog-icon name="chevron-left" [size]="16" tone="current" />
        Back to your chats
      </a>

      @if (activating()) {
        <section class="pricing__activating" role="status">
          <cog-icon name="loader" [size]="28" tone="brand" />
          <h1 class="pricing__title">Activating your plan…</h1>
          @if (activationSlow()) {
            <p class="pricing__subtitle">
              This is taking longer than usual. Your plan will appear here as soon as
              the payment is confirmed — no need to pay again.
            </p>
          } @else {
            <p class="pricing__subtitle">
              Hang tight — we're confirming your payment. This usually takes a few
              seconds.
            </p>
          }
        </section>
      } @else {
        <header class="pricing__intro">
          @if (billing.isSendingLocked()) {
            <span class="pricing__status">
              <cog-icon name="lock" [size]="14" tone="text-subtle" />
              {{ billing.isTrialUsedUp() ? 'Trial credits used up' : 'Sending paused' }}
            </span>
          }

          <h1 class="pricing__title">Keep going, privately</h1>
          <p class="pricing__subtitle">
            Your trial chats are still here and fully readable. Pick a plan to send new
            messages — same encryption, same Swiss compute.
          </p>

          <div class="pricing__interval" role="group" aria-label="Billing interval">
            <button
              type="button"
              class="pricing__interval-option"
              [class.pricing__interval-option--active]="interval() === 'monthly'"
              [attr.aria-pressed]="interval() === 'monthly'"
              (click)="interval.set('monthly')"
            >
              Monthly
            </button>
            <button
              type="button"
              class="pricing__interval-option"
              [class.pricing__interval-option--active]="interval() === 'yearly'"
              [attr.aria-pressed]="interval() === 'yearly'"
              (click)="interval.set('yearly')"
            >
              Yearly
              <cog-lozenge tone="green">2 months free</cog-lozenge>
            </button>
          </div>
        </header>

        <div class="pricing__plans">
          <!-- Pay as you go -->
          <section class="pricing__card">
            <div class="pricing__card-head">
              <h2 class="pricing__plan-name">Pay as you go</h2>
              <cog-lozenge tone="blue">Flexible</cog-lozenge>
            </div>
            <p class="pricing__plan-blurb">
              Buy credits and spend them on any model. A CHF 10 minimum keeps your
              account active each month.
            </p>

            <p class="pricing__price">
              <span class="pricing__price-amount">CHF 10</span>
              <span class="pricing__price-unit">/ month min.</span>
            </p>
            <p class="pricing__price-note">Billed monthly · top up anytime</p>

            <cog-button
              appearance="default"
              [fullWidth]="true"
              [disabled]="checkoutPending()"
              (click)="selectPlan('payg')"
            >
              Start with credits
            </cog-button>

            <ul class="pricing__features">
              @for (feature of paygFeatures; track feature.label) {
                <li [class.pricing__feature--muted]="feature.muted">
                  <cog-icon
                    name="check"
                    [size]="16"
                    [tone]="feature.muted ? 'text-subtlest' : 'success'"
                  />
                  {{ feature.label }}
                </li>
              }
            </ul>

            <p class="pricing__fine">
              Spend above the CHF 10 minimum is metered per message.
            </p>
          </section>

          <!-- Unlimited -->
          <section class="pricing__card pricing__card--featured">
            <div class="pricing__card-head">
              <h2 class="pricing__plan-name">Unlimited</h2>
              <cog-lozenge tone="green">Recommended</cog-lozenge>
            </div>
            <p class="pricing__plan-blurb">
              Unlimited messages across every Cognos model, with priority Swiss-cloud
              compute.
            </p>

            @if (interval() === 'monthly') {
              <p class="pricing__price">
                <span class="pricing__price-amount">CHF 100</span>
                <span class="pricing__price-unit">/ month</span>
              </p>
              <p class="pricing__price-note pricing__price-note--accent">
                CHF 1'000/yr saves you CHF 200
              </p>
            } @else {
              <p class="pricing__price">
                <span class="pricing__price-amount">CHF 1'000</span>
                <span class="pricing__price-unit">/ year</span>
              </p>
              <p class="pricing__price-note pricing__price-note--accent">
                Two months free vs monthly
              </p>
            }

            <cog-button
              appearance="primary"
              [fullWidth]="true"
              [disabled]="checkoutPending()"
              (click)="selectPlan('unlimited')"
            >
              Go Unlimited
            </cog-button>

            <ul class="pricing__features">
              @for (feature of unlimitedFeatures; track feature) {
                <li>
                  <cog-icon name="check" [size]="16" tone="success" />
                  {{ feature }}
                </li>
              }
            </ul>

            <p class="pricing__fine">
              <cog-icon name="info" [size]="14" tone="text-subtlest" />
              Fair use applies
            </p>
          </section>
        </div>

        <section class="pricing__guarantee">
          <span class="pricing__guarantee-icon">
            <cog-icon name="shield-check" [size]="20" tone="success" />
          </span>
          <div>
            <div class="pricing__guarantee-title">60-day money-back guarantee</div>
            <p class="pricing__guarantee-body">
              Not the right fit? Cancel within 60 days of your first payment for a full
              refund — on either plan, no questions asked.
            </p>
          </div>
        </section>

        <div class="pricing__assurances">
          <div class="pricing__assurance">
            <cog-icon name="file-text" [size]="18" tone="text-subtle" />
            <div>
              <div class="pricing__assurance-title">Trial chats stay readable</div>
              <p>Nothing is deleted when the trial ends.</p>
            </div>
          </div>
          <div class="pricing__assurance">
            <cog-icon name="key-round" [size]="18" tone="text-subtle" />
            <div>
              <div class="pricing__assurance-title">Encrypted billing</div>
              <p>We store payment tokens, never card numbers.</p>
            </div>
          </div>
          <div class="pricing__assurance">
            <cog-icon name="x" [size]="18" tone="text-subtle" />
            <div>
              <div class="pricing__assurance-title">No lock-in</div>
              <p>Switch plans or cancel from settings anytime.</p>
            </div>
          </div>
        </div>

        <p class="pricing__footer">
          Prices in CHF, incl. VAT. Questions about a plan?
          <a href="mailto:support@cognos.io" class="pricing__link">Talk to us</a>.
        </p>
      }
    </main>
  `,
  styleUrl: './pricing.component.scss',
})
export class PricingComponent {
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);
  private readonly _destroyRef = inject(DestroyRef);
  public readonly billing = inject(BillingService);

  readonly interval = signal<BillingInterval>('monthly');
  // True while we wait (post-Paddle redirect) for the plan to go live.
  readonly activating = signal(false);
  // True once the poll gives up — the plan may still be settling server-side.
  readonly activationSlow = signal(false);

  constructor() {
    if (this._route.snapshot.queryParamMap.get('status') === 'activating') {
      this.startActivationPoll();
    }
  }

  // After checkout Paddle returns the user here; the subscription.created
  // webhook lands asynchronously, so poll the plan state until it flips to a
  // paid plan, then drop the user back into the chat.
  private startActivationPoll(): void {
    this.activating.set(true);
    timer(0, ACTIVATION_POLL_INTERVAL_MS)
      .pipe(
        take(ACTIVATION_POLL_MAX_ATTEMPTS),
        switchMap(() => this.billing.fetchState()),
        takeUntilDestroyed(this._destroyRef),
      )
      .subscribe({
        next: (state) => {
          if (state.plan_type === 'payg' || state.plan_type === 'unlimited') {
            this.activating.set(false);
            void this._router.navigate(['/']);
          }
        },
        complete: () => {
          // Ran out of attempts without a paid plan landing.
          if (this.activating()) {
            this.activationSlow.set(true);
          }
        },
      });
  }

  protected readonly paygFeatures = [
    { label: 'Credits work on every model and skill', muted: false },
    { label: 'Pay only for what you actually run', muted: false },
    { label: 'Unused credits roll over while active', muted: false },
    { label: 'No annual commitment', muted: true },
  ];

  protected readonly unlimitedFeatures = [
    'Unlimited messages on every model',
    'Priority Swiss-cloud & on-prem compute',
    'All skills, prompt library and sharing',
    'Cancel anytime — keeps working to period end',
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
