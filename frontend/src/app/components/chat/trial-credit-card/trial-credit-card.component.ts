import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { Router } from '@angular/router';

import {
  CognosButtonComponent,
  CognosIconComponent,
  CognosLozengeComponent,
  CognosProgressComponent,
} from '@cognos/ui-angular';

import { BillingService } from '@app/services/billing.service';

// TrialCreditCardComponent sits above the sidebar profile button during the
// trial. It shows how much trial credit is left as a meter and, once spent,
// flips to a "used up" state pointing at the pricing page. It never replaces
// the profile button — it's an additional, trial-only card.
@Component({
  selector: 'app-trial-credit-card',
  standalone: true,
  imports: [
    CognosButtonComponent,
    CognosIconComponent,
    CognosLozengeComponent,
    CognosProgressComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="trial-credit">
      <header class="trial-credit__head">
        <span class="trial-credit__label">
          <cog-icon name="sparkles" [size]="16" tone="brand" />
          Trial credit
        </span>
        @if (usedUp()) {
          <cog-lozenge tone="red">Used up</cog-lozenge>
        }
      </header>

      <cog-progress
        class="trial-credit__bar"
        [value]="usedPercent()"
        [tone]="usedUp() ? 'var(--cog-danger-text)' : 'var(--cog-brand)'"
        [height]="6"
      />

      <p class="trial-credit__detail">
        CHF {{ balance().toFixed(2) }} left of your CHF {{ seed().toFixed(2) }} trial
      </p>

      <cog-button
        appearance="primary"
        icon="chevron-right"
        [fullWidth]="true"
        (click)="goToBilling()"
      >
        Choose a plan
      </cog-button>
    </section>
  `,
  styles: `
    :host {
      display: block;
    }

    .trial-credit {
      display: grid;
      gap: var(--cog-space-100);
      border: 1px solid var(--cog-border);
      border-radius: var(--cog-radius-md);
      background: var(--cog-surface);
      padding: var(--cog-space-150);
    }

    .trial-credit__head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--cog-space-100);
    }

    .trial-credit__label {
      display: inline-flex;
      align-items: center;
      gap: var(--cog-space-050);
      color: var(--cog-text);
      font-weight: var(--cog-fw-semibold);
      font-size: var(--cog-fs-body-sm);
    }

    .trial-credit__detail {
      margin: 0;
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-caption);
      line-height: var(--cog-lh-caption);
    }
  `,
})
export class TrialCreditCardComponent {
  private readonly _router = inject(Router);
  public readonly billing = inject(BillingService);

  protected readonly balance = computed(() => Math.max(0, this.billing.balanceChf()));
  protected readonly seed = computed(() => this.billing.trialSeedChf());
  protected readonly usedUp = computed(() => this.billing.isTrialUsedUp());

  // Meter shows the consumed fraction, so it fills as credit is spent and is
  // full once used up.
  protected readonly usedPercent = computed(() => {
    const seed = this.seed();
    if (seed <= 0) {
      return this.usedUp() ? 100 : 0;
    }
    const used = (seed - this.balance()) / seed;
    return Math.min(100, Math.max(0, used * 100));
  });

  protected goToBilling(): void {
    void this._router.navigate(['/pricing']);
  }
}
