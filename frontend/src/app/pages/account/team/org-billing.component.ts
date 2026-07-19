import { DatePipe, formatDate } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  LOCALE_ID,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';

import {
  CognosButtonComponent,
  CognosCalloutComponent,
  CognosCardComponent,
  CognosLozengeComponent,
  CognosProgressComponent,
} from '@cognos/ui-angular';

import { BILLING_PRICES } from '@app/billing/pricing';
import {
  OrgBillingRecord,
  OrgMemberUsageRecord,
  OrgUsageRecord,
  OrganisationRecord,
} from '@app/interfaces/organisation';
import { CognosApiService } from '@app/services/cognos-api.service';
import { ErrorService } from '@app/services/error.service';
import { ModelService } from '@app/services/model.service';
import { chfFromRappen } from '@app/utils/currency';

import { OverageDisplay, overageDisplay } from './org-overage';

// OrgBillingComponent is the Owner/Admin billing-and-usage dashboard (spec
// §5.6–5.8). Non-negotiables baked into this page:
// - the projected pooled overage is visible BEFORE cycle close, never as an
//   invoice surprise;
// - a billing failure surfaces exactly ONE actionable next step (Owner:
//   update the payment method; Admin: ask the Owner);
// - lapsed/missing billing states say plainly that org Projects are read-only
//   and never imply a member's personal balance covers the gap;
// - the per-member table is METADATA ONLY — usage and costs, never
//   conversations — and says so right next to the numbers.
@Component({
  selector: 'app-org-billing',
  standalone: true,
  imports: [
    DatePipe,
    CognosButtonComponent,
    CognosCalloutComponent,
    CognosCardComponent,
    CognosLozengeComponent,
    CognosProgressComponent,
    TranslocoModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <ng-container *transloco="let t">
      <cog-card [heading]="t('team.billing.heading')">
        @if (billing()) {
          <cog-lozenge card-heading-actions [tone]="statusTone()">{{
            t(statusKey())
          }}</cog-lozenge>
        }

        @if (billingLoading()) {
          <p class="org-billing__state" role="status">{{ t('team.loading') }}</p>
        } @else if (billingError()) {
          <cog-callout tone="danger" icon="triangle-alert">
            {{ t('team.billing.loadError') }}
          </cog-callout>
        } @else if (billing(); as b) {
          @if (b.past_due) {
            <cog-callout tone="danger" icon="triangle-alert">
              {{ t('team.billing.pastDueBody') }}
            </cog-callout>
            @if (!isOwner()) {
              <p class="org-billing__ask">{{ t('team.billing.pastDueAskOwner') }}</p>
            }
          } @else if (b.plan_type === 'inactive') {
            <cog-callout tone="warning" icon="info">
              {{ t('team.billing.inactiveBody') }}
            </cog-callout>
            @if (!isOwner()) {
              <p class="org-billing__ask">{{ t('team.billing.inactiveAskOwner') }}</p>
            }
          } @else {
            <dl class="org-billing__stats">
              <div class="org-billing__stat">
                <dt>{{ t('team.billing.seats') }}</dt>
                <dd>
                  {{ b.seat_quantity }}
                  <span class="org-billing__stat-hint">{{
                    t('team.billing.seatsHint', {
                      price: seatPrice,
                      minSeats: minSeats,
                    })
                  }}</span>
                  <span class="org-billing__stat-note">{{
                    t('team.billing.seatsMinimum', { minSeats: minSeats })
                  }}</span>
                  @if (b.pending_seat_quantity < b.seat_quantity) {
                    <span class="org-billing__stat-note">{{
                      t('team.billing.pendingSeats', {
                        count: b.pending_seat_quantity,
                      })
                    }}</span>
                  }
                </dd>
              </div>
              <div class="org-billing__stat">
                <dt>{{ t('team.billing.cycle') }}</dt>
                <dd>
                  {{ b.cycle_start_at | date: 'mediumDate' }} –
                  {{ b.cycle_end_at | date: 'mediumDate' }}
                </dd>
              </div>
              <div class="org-billing__stat">
                <dt>{{ t('team.billing.floor') }}</dt>
                <dd>{{ chf(b.floor_rappen) }}</dd>
              </div>
              <div class="org-billing__stat">
                <dt>{{ t('team.billing.usageSoFar') }}</dt>
                <dd>{{ chf(b.pooled_usage_rappen) }}</dd>
              </div>
            </dl>

            @if (overage(); as ov) {
              <div class="org-billing__overage" data-testid="org-overage">
                <span class="org-billing__visually-hidden">{{
                  t('team.billing.progressLabel', { percent: ov.progressPercent })
                }}</span>
                <cog-progress [value]="ov.progressPercent" />
                @switch (ov.state) {
                  @case ('over') {
                    <cog-callout tone="warning" icon="triangle-alert">
                      <strong>{{
                        t('team.billing.projectedOverTitle', {
                          amount: chf(ov.overageRappen),
                        })
                      }}</strong>
                      {{
                        t('team.billing.projectedOverBody', {
                          date: cycleEndLabel(),
                        })
                      }}
                    </cog-callout>
                  }
                  @case ('at') {
                    <cog-callout tone="info" icon="info">
                      {{ t('team.billing.projectedAt', { date: cycleEndLabel() }) }}
                    </cog-callout>
                  }
                  @default {
                    <p class="org-billing__headroom">
                      {{
                        t('team.billing.projectedUnder', {
                          amount: chf(ov.remainingRappen),
                        })
                      }}
                    </p>
                  }
                }
              </div>
            }
          }
        }

        @if (billingError()) {
          <ng-container card-actions>
            <cog-button appearance="default" (click)="reload()">{{
              t('team.retry')
            }}</cog-button>
          </ng-container>
        }
        @if (billing(); as b) {
          @if (b.past_due && isOwner()) {
            <ng-container card-actions>
              <cog-button
                appearance="primary"
                icon="credit-card"
                [disabled]="actionPending()"
                (click)="openPortal()"
                >{{ t('team.billing.pastDueAction') }}</cog-button
              >
            </ng-container>
          }
          @if (!b.past_due && b.plan_type === 'inactive' && isOwner()) {
            <ng-container card-actions>
              <cog-button
                appearance="primary"
                icon="credit-card"
                [disabled]="actionPending()"
                (click)="startCheckout()"
                >{{ t('team.billing.inactiveAction') }}</cog-button
              >
            </ng-container>
          }
        }
      </cog-card>

      <cog-card
        [heading]="t('team.billing.perMemberHeading')"
        [subtitle]="t('team.billing.metadataOnly')"
      >
        @if (usageLoading()) {
          <p class="org-billing__state" role="status">{{ t('team.loading') }}</p>
        } @else if (usageError()) {
          <cog-callout tone="danger" icon="triangle-alert">
            {{ t('team.billing.usageLoadError') }}
          </cog-callout>
        } @else if (memberUsage().length === 0) {
          <p class="org-billing__state" role="status">
            {{ t('team.billing.usageEmpty') }}
          </p>
        } @else {
          <div class="org-billing__scroll">
            <table class="org-billing__table">
              <caption class="org-billing__visually-hidden">
                {{
                  t('team.billing.perMemberHeading')
                }}
              </caption>
              <thead>
                <tr>
                  <th scope="col">{{ t('team.billing.colMember') }}</th>
                  <th scope="col" class="org-billing__num">
                    {{ t('team.billing.colCost') }}
                  </th>
                  <th scope="col" class="org-billing__num">
                    {{ t('team.billing.colCompletions') }}
                  </th>
                  <th scope="col">{{ t('team.billing.colModels') }}</th>
                </tr>
              </thead>
              <tbody>
                @for (row of memberUsage(); track row.user) {
                  <tr>
                    <td>{{ row.display_name || row.user }}</td>
                    <td class="org-billing__num">{{ chf(row.cost_rappen) }}</td>
                    <td class="org-billing__num">{{ row.completions }}</td>
                    <td>{{ modelNames(row) }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }

        @if (usageError()) {
          <ng-container card-actions>
            <cog-button appearance="default" (click)="reload()">{{
              t('team.retry')
            }}</cog-button>
          </ng-container>
        }
      </cog-card>
    </ng-container>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: var(--cog-space-200);
    }

    .org-billing__state {
      margin: 0;
      color: var(--cog-text-muted);
      font-size: var(--cog-fs-body);
    }

    .org-billing__ask {
      margin: 0;
      color: var(--cog-text);
      font-size: var(--cog-fs-body);
    }

    .org-billing__stats {
      display: grid;
      margin: 0;
      gap: var(--cog-space-150);
      grid-template-columns: repeat(auto-fit, minmax(160px, 1fr));
    }

    .org-billing__stat {
      dt {
        color: var(--cog-text-muted);
        font-size: var(--cog-fs-small);
      }

      dd {
        display: flex;
        flex-direction: column;
        margin: 0;
        color: var(--cog-text);
        font-size: var(--cog-fs-body);
        font-variant-numeric: tabular-nums;
        font-weight: 500;
      }
    }

    .org-billing__stat-hint {
      color: var(--cog-text-muted);
      font-size: var(--cog-fs-small);
      font-weight: 400;
    }

    .org-billing__stat-note {
      color: var(--cog-text-muted);
      font-size: var(--cog-fs-small);
      font-weight: 400;
    }

    .org-billing__overage {
      display: flex;
      flex-direction: column;
      margin-top: var(--cog-space-150);
      gap: var(--cog-space-100);
    }

    .org-billing__headroom {
      margin: 0;
      color: var(--cog-text-muted);
      font-size: var(--cog-fs-body);
    }

    .org-billing__scroll {
      overflow-x: auto;
    }

    .org-billing__table {
      width: 100%;
      border-collapse: collapse;
      font-size: var(--cog-fs-body);

      th {
        padding: var(--cog-space-50) var(--cog-space-100);
        border-bottom: 1px solid var(--cog-border);
        color: var(--cog-text-muted);
        font-size: var(--cog-fs-small);
        font-weight: 500;
        text-align: left;
      }

      td {
        padding: var(--cog-space-100);
        border-bottom: 1px solid var(--cog-border);
        color: var(--cog-text);
        vertical-align: middle;
      }

      tr:last-child td {
        border-bottom: none;
      }
    }

    .org-billing__num {
      font-variant-numeric: tabular-nums;
      text-align: right;
    }

    .org-billing__visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip: rect(0 0 0 0);
      white-space: nowrap;
    }
  `,
})
export class OrgBillingComponent {
  private readonly _api = inject(CognosApiService);
  private readonly _models = inject(ModelService);
  private readonly _errors = inject(ErrorService);
  private readonly _transloco = inject(TranslocoService);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _locale = inject(LOCALE_ID);

  /** The Organisation being managed (caller is Owner/Admin). */
  readonly org = input.required<OrganisationRecord>();

  protected readonly billing = signal<OrgBillingRecord | null>(null);
  protected readonly billingLoading = signal(true);
  protected readonly billingError = signal(false);

  protected readonly usage = signal<OrgUsageRecord | null>(null);
  protected readonly usageLoading = signal(true);
  protected readonly usageError = signal(false);

  protected readonly actionPending = signal(false);

  protected readonly seatPrice = BILLING_PRICES.orgSeatMonthly;
  protected readonly minSeats = BILLING_PRICES.orgSeatMinimum;

  protected readonly isOwner = computed(() => this.org().role === 'owner');

  protected readonly overage = computed<OverageDisplay | null>(() => {
    const billing = this.billing();
    return billing ? overageDisplay(billing) : null;
  });

  protected readonly memberUsage = computed<OrgMemberUsageRecord[]>(
    () => this.usage()?.members ?? [],
  );

  protected readonly statusKey = computed(() => {
    const billing = this.billing();
    if (billing?.past_due) {
      return 'team.billing.statusPastDue';
    }
    if (billing?.plan_type === 'payg') {
      return 'team.billing.statusActive';
    }
    return 'team.billing.statusInactive';
  });

  protected readonly statusTone = computed<'green' | 'red' | 'neutral'>(() => {
    const billing = this.billing();
    if (billing?.past_due) {
      return 'red';
    }
    return billing?.plan_type === 'payg' ? 'green' : 'neutral';
  });

  constructor() {
    // Reload both panels whenever the managed Organisation changes.
    effect(() => this.load(this.org().id));
  }

  protected reload(): void {
    this.load(this.org().id);
  }

  private load(orgId: string): void {
    this.billingLoading.set(true);
    this.billingError.set(false);
    this._api
      .getOrgBilling(orgId)
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({
        next: (billing) => {
          this.billing.set(billing);
          this.billingLoading.set(false);
        },
        error: () => {
          this.billingLoading.set(false);
          this.billingError.set(true);
        },
      });

    this.usageLoading.set(true);
    this.usageError.set(false);
    this._api
      .getOrgUsage(orgId)
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({
        next: (usage) => {
          this.usage.set(usage);
          this.usageLoading.set(false);
        },
        error: () => {
          this.usageLoading.set(false);
          this.usageError.set(true);
        },
      });
  }

  protected chf(rappen: number): string {
    return chfFromRappen(rappen);
  }

  protected cycleEndLabel(): string {
    const end = this.billing()?.cycle_end_at;
    return end ? formatDate(end, 'mediumDate', this._locale) : '';
  }

  protected modelNames(row: OrgMemberUsageRecord): string {
    if (row.top_models.length === 0) {
      return '—';
    }
    const catalogue = this._models.modelList();
    return row.top_models
      .map((id) => catalogue.find((model) => model.id === id)?.name ?? id)
      .join(', ');
  }

  /** Owner-only: fix a failed payment — the single actionable step. */
  protected openPortal(): void {
    if (this.actionPending()) {
      return;
    }
    this.actionPending.set(true);
    this._api
      .getOrgBillingPortal(this.org().id)
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({
        next: (res) => {
          this.actionPending.set(false);
          this.openUrl(res.portal_url);
        },
        error: () => {
          this.actionPending.set(false);
          this._errors.alert(this._transloco.translate('team.billing.portalError'));
        },
      });
  }

  /** Owner-only: complete checkout for an Organisation without billing. */
  protected startCheckout(): void {
    if (this.actionPending()) {
      return;
    }
    this.actionPending.set(true);
    this._api
      .createOrgCheckout(this.org().id)
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({
        next: (res) => {
          this.actionPending.set(false);
          this.redirect(res.checkout_url);
        },
        error: () => {
          this.actionPending.set(false);
          this._errors.alert(this._transloco.translate('team.create.checkoutError'));
        },
      });
  }

  // Thin navigation seams so tests can observe without leaving the page.
  protected openUrl(url: string): void {
    window.open(url, '_blank', 'noopener');
  }

  protected redirect(url: string): void {
    window.location.assign(url);
  }
}
