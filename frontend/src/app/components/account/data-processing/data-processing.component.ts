import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';

import { CognosIconComponent, CognosLozengeComponent } from '@cognos/ui-angular';
import type { CognosIconName } from '@cognos/ui/icons';

import { Model, PrivacyTier } from '@app/interfaces/model';
import { AuthService } from '@app/services/auth.service';
import { ModelService } from '@app/services/model.service';

interface TierOption {
  id: PrivacyTier;
  name: string;
  icon: CognosIconName;
  blurb: string;
  note: string;
}

// Ordered most-restrictive first, matching how residency is presented to the
// user (Switzerland → Europe → Global).
const TIER_OPTIONS: TierOption[] = [
  {
    id: 'ch_only',
    name: 'Switzerland only',
    icon: 'shield-check',
    blurb: 'Processed only on Swiss soil — on-prem and Swiss cloud.',
    note: 'Strictest residency',
  },
  {
    id: 'eu',
    name: 'Europe + Switzerland + UK',
    icon: 'landmark',
    blurb: 'Processed within the EU/EEA, the United Kingdom and Switzerland.',
    note: 'Adequacy-aligned',
  },
  {
    id: 'global',
    name: 'Global',
    icon: 'cloud',
    blurb: 'Processed in vetted data centres worldwide, routed to the nearest region.',
    note: 'Every model',
  },
];

const TIER_RANK: Record<PrivacyTier, number> = { ch_only: 0, eu: 1, global: 2 };

const TIER_BADGE: Record<PrivacyTier, string> = {
  ch_only: 'Switzerland only',
  eu: 'Europe + UK',
  global: 'Global',
};

// Short residency label shown on each model row.
const MODEL_REGION_BADGE: Record<PrivacyTier, string> = {
  ch_only: 'Swiss',
  eu: 'EU',
  global: 'Global',
};

// DataProcessingComponent lets the user choose where their messages may be
// processed (the privacy tier), which is the single control over model
// eligibility. Selecting a tier patches the user record; the model catalogue
// re-fetches and eligibility updates reactively.
@Component({
  selector: 'app-data-processing',
  standalone: true,
  imports: [CognosIconComponent, CognosLozengeComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="data-processing" aria-labelledby="data-processing-heading">
      <header class="data-processing__head">
        <span class="data-processing__head-icon">
          <cog-icon name="server" [size]="18" tone="current" />
        </span>
        <div class="data-processing__head-text">
          <h2 id="data-processing-heading" class="data-processing__title">
            Data processing
          </h2>
          <p class="data-processing__subtitle">
            Choose where your messages may be processed. This is the only thing that
            changes which models you can use — it has no effect on how your chats are
            stored: your history is always saved encrypted, never as plaintext.
          </p>
        </div>
        <cog-lozenge tone="green">{{ currentBadge() }}</cog-lozenge>
      </header>

      <div
        class="data-processing__tiers"
        role="radiogroup"
        aria-label="Data processing region"
      >
        @for (tier of tiers; track tier.id) {
          <button
            type="button"
            role="radio"
            class="data-processing__tier"
            [class.data-processing__tier--active]="tier.id === currentTier()"
            [attr.aria-checked]="tier.id === currentTier()"
            [disabled]="saving()"
            (click)="selectTier(tier.id)"
          >
            <span class="data-processing__tier-top">
              <span class="data-processing__tier-icon">
                <cog-icon [name]="tier.icon" [size]="16" tone="current" />
              </span>
              @if (tier.id === currentTier()) {
                <cog-icon
                  class="data-processing__tier-check"
                  name="check"
                  [size]="16"
                  tone="success"
                />
              } @else {
                <span class="data-processing__tier-radio" aria-hidden="true"></span>
              }
            </span>
            <span class="data-processing__tier-name">{{ tier.name }}</span>
            <span class="data-processing__tier-blurb">{{ tier.blurb }}</span>
            <span class="data-processing__tier-foot">
              <cog-lozenge tone="neutral"
                >{{ modelCountForTier(tier.id) }} models</cog-lozenge
              >
              <span class="data-processing__tier-note">{{ tier.note }}</span>
            </span>
          </button>
        }
      </div>

      <div class="data-processing__retention">
        <cog-icon name="shield-check" [size]="18" tone="success" />
        <div>
          <p class="data-processing__retention-title">
            No plaintext retention — every region
          </p>
          <p class="data-processing__retention-body">
            Approved providers process your messages under no-retention, no-training
            terms, and Cognos never stores plaintext prompts or responses — your chat
            history is saved encrypted. This setting only controls the jurisdiction your
            messages pass through while a model answers, and which models that makes
            available.
          </p>
        </div>
      </div>

      <section class="models" aria-labelledby="models-heading">
        <header class="models__head">
          <h3 id="models-heading" class="models__title">
            Models available
            <cog-lozenge tone="neutral"
              >{{ eligibleCount() }} of {{ totalCount() }}</cog-lozenge
            >
          </h3>
          <span class="models__region">{{ currentBadge() }}</span>
        </header>

        <ul class="models__list">
          @for (model of orderedModels(); track model.id) {
            <li class="models__row" [class.models__row--locked]="!model.isEligible">
              <span class="models__icon">
                <cog-icon
                  [name]="model.isEligible ? 'server' : 'lock'"
                  [size]="16"
                  tone="current"
                />
              </span>
              <span class="models__body">
                <span class="models__name-row">
                  <span class="models__name">{{ model.name }}</span>
                  <cog-lozenge [tone]="model.isEligible ? 'green' : 'neutral'">
                    {{ regionBadge(model) }}
                  </cog-lozenge>
                </span>
                <span class="models__desc">{{ model.description }}</span>
              </span>
              <span class="models__meta">
                @if (model.isEligible) {
                  @if (hostingLabel(model)) {
                    <span class="models__location">{{ hostingLabel(model) }}</span>
                  }
                  <span class="models__context"
                    >{{ formatContext(model.inputContextLength) }} context</span
                  >
                } @else {
                  <span class="models__locked">
                    <cog-icon name="lock" [size]="12" tone="current" />
                    {{ model.ineligibilityReason || 'Needs broader region' }}
                  </span>
                }
              </span>
            </li>
          }
        </ul>

        @if (lockedCount() > 0) {
          <p class="models__footnote">
            <cog-icon name="lock" [size]="14" tone="current" />
            {{ lockedCount() }} more
            {{ lockedCount() === 1 ? 'model unlocks' : 'models unlock' }} if you widen
            your processing region — still no-retention providers, still encrypted.
          </p>
        }
      </section>
    </section>
  `,
  styles: `
    :host {
      display: block;
    }

    .data-processing {
      display: grid;
      gap: var(--cog-space-250);
      border: 1px solid var(--cog-border);
      border-radius: var(--cog-radius-md);
      background: var(--cog-surface);
      padding: var(--cog-space-250);
    }

    .data-processing__head {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr) auto;
      align-items: start;
      gap: var(--cog-space-125);
    }

    .data-processing__head-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border-radius: var(--cog-radius-sm);
      background: var(--cog-info-bg, var(--cog-surface-raised));
      color: var(--cog-text-subtle);
    }

    .data-processing__head-text {
      display: grid;
      gap: var(--cog-space-050);
    }

    .data-processing__title {
      margin: 0;
      color: var(--cog-text);
      font-size: var(--cog-fs-h-sm, var(--cog-fs-body));
      font-weight: var(--cog-fw-semibold);
      line-height: var(--cog-lh-body);
    }

    .data-processing__subtitle {
      margin: 0;
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-body-sm);
      line-height: var(--cog-lh-body-sm);
      text-wrap: pretty;
    }

    .data-processing__tiers {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
      gap: var(--cog-space-150);
    }

    .data-processing__tier {
      display: grid;
      gap: var(--cog-space-125);
      align-content: start;
      border: 2px solid var(--cog-border);
      border-radius: var(--cog-radius-md);
      background: var(--cog-surface);
      padding: var(--cog-space-175, 16px);
      text-align: left;
      cursor: pointer;
      font: inherit;
      color: var(--cog-text);
      transition:
        border-color var(--cog-dur-fast) var(--cog-ease-standard),
        background-color var(--cog-dur-fast) var(--cog-ease-standard);
    }

    .data-processing__tier:hover:not(:disabled) {
      border-color: var(--cog-border-strong, var(--cog-text-subtlest));
    }

    .data-processing__tier:disabled {
      cursor: progress;
      opacity: 0.7;
    }

    .data-processing__tier--active {
      border-color: var(--cog-brand);
      background: var(--cog-selected-bg, rgba(46, 160, 67, 0.08));
    }

    .data-processing__tier-top {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    .data-processing__tier-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border-radius: var(--cog-radius-sm);
      background: var(--cog-surface-raised, rgba(0, 0, 0, 0.04));
      color: var(--cog-text-subtle);
    }

    .data-processing__tier--active .data-processing__tier-icon {
      background: var(--cog-brand);
      color: var(--cog-on-brand, #fff);
    }

    .data-processing__tier-radio {
      width: 16px;
      height: 16px;
      border: 2px solid var(--cog-border-strong, var(--cog-text-subtlest));
      border-radius: var(--cog-radius-pill);
    }

    .data-processing__tier-name {
      font-size: var(--cog-fs-body);
      font-weight: var(--cog-fw-semibold);
      line-height: var(--cog-lh-body);
    }

    .data-processing__tier-blurb {
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-caption);
      line-height: var(--cog-lh-caption);
    }

    .data-processing__tier-foot {
      display: flex;
      align-items: center;
      gap: var(--cog-space-100);
      margin-top: var(--cog-space-050);
    }

    .data-processing__tier-count {
      font-size: var(--cog-fs-caption);
      font-weight: var(--cog-fw-semibold);
      letter-spacing: var(--cog-ls-overline);
      text-transform: uppercase;
      color: var(--cog-text);
    }

    .data-processing__tier-note {
      color: var(--cog-text-subtlest);
      font-size: var(--cog-fs-caption);
    }

    .data-processing__retention {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      gap: var(--cog-space-125);
      border-radius: var(--cog-radius-sm);
      background: var(--cog-success-bg, rgba(46, 160, 67, 0.1));
      padding: var(--cog-space-150);
    }

    .data-processing__retention-title {
      margin: 0 0 var(--cog-space-025);
      color: var(--cog-success-text, var(--cog-text));
      font-size: var(--cog-fs-body-sm);
      font-weight: var(--cog-fw-semibold);
      line-height: var(--cog-lh-body-sm);
    }

    .data-processing__retention-body {
      margin: 0;
      color: var(--cog-success-text, var(--cog-text-subtle));
      font-size: var(--cog-fs-caption);
      line-height: var(--cog-lh-caption);
      text-wrap: pretty;
    }

    .models__head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: var(--cog-space-100);
      padding: 0 var(--cog-space-050) var(--cog-space-100);
    }

    .models__title {
      margin: 0;
      display: inline-flex;
      align-items: baseline;
      gap: var(--cog-space-100);
      color: var(--cog-text-subtlest);
      font-size: var(--cog-fs-caption);
      font-weight: var(--cog-fw-semibold);
      letter-spacing: var(--cog-ls-overline);
      text-transform: uppercase;
    }

    .models__count {
      color: var(--cog-text-subtle);
    }

    .models__region {
      color: var(--cog-text-subtlest);
      font-size: var(--cog-fs-caption);
    }

    .models__list {
      list-style: none;
      margin: 0;
      padding: 0;
    }

    .models__row {
      display: grid;
      grid-template-columns: 32px minmax(0, 1fr) auto;
      align-items: center;
      gap: var(--cog-space-125);
      padding: var(--cog-space-150) var(--cog-space-050);
      border-bottom: 1px solid var(--cog-border-subtle, var(--cog-border));
    }

    .models__row:last-child {
      border-bottom: 0;
    }

    .models__row--locked {
      opacity: 0.55;
    }

    .models__icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border-radius: var(--cog-radius-sm);
      background: var(--cog-surface-raised, rgba(0, 0, 0, 0.04));
      color: var(--cog-text-subtle);
    }

    .models__body {
      display: grid;
      gap: var(--cog-space-025, 2px);
      min-width: 0;
    }

    .models__name-row {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--cog-space-075);
    }

    .models__name {
      color: var(--cog-text);
      font-size: var(--cog-fs-body-sm);
      font-weight: var(--cog-fw-semibold);
      line-height: var(--cog-lh-body-sm);
    }

    .models__desc {
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-caption);
      line-height: var(--cog-lh-caption);
    }

    .models__meta {
      display: grid;
      justify-items: end;
      gap: var(--cog-space-025, 2px);
      text-align: right;
      white-space: nowrap;
    }

    .models__location {
      color: var(--cog-text);
      font-size: var(--cog-fs-caption);
      font-weight: var(--cog-fw-semibold);
    }

    .models__context {
      color: var(--cog-text-subtlest);
      font-size: var(--cog-fs-caption);
    }

    .models__locked {
      display: inline-flex;
      align-items: center;
      gap: var(--cog-space-050);
      color: var(--cog-text-subtlest);
      font-size: var(--cog-fs-caption);
    }

    .models__footnote {
      display: flex;
      align-items: center;
      gap: var(--cog-space-075);
      margin: var(--cog-space-050) 0 0;
      border-radius: var(--cog-radius-sm);
      background: var(--cog-surface-raised, rgba(0, 0, 0, 0.03));
      padding: var(--cog-space-100) var(--cog-space-125);
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-caption);
      line-height: var(--cog-lh-caption);
    }
  `,
})
export class DataProcessingComponent {
  private readonly _models = inject(ModelService);
  private readonly _auth = inject(AuthService);

  protected readonly tiers = TIER_OPTIONS;
  protected readonly saving = signal(false);

  protected readonly currentTier = this._models.privacyTier;
  protected readonly currentBadge = computed(() => TIER_BADGE[this.currentTier()]);

  private readonly _modelList = this._models.modelList;
  protected readonly totalCount = computed(() => this._modelList().length);
  protected readonly eligibleCount = computed(
    () => this._modelList().filter((model) => model.isEligible).length,
  );
  protected readonly lockedCount = computed(
    () => this.totalCount() - this.eligibleCount(),
  );

  // Eligible models first, then locked ones (shown greyed), matching the mock.
  protected readonly orderedModels = computed(() =>
    [...this._modelList()].sort((a, b) => Number(b.isEligible) - Number(a.isEligible)),
  );

  protected regionBadge(model: Model): string {
    return MODEL_REGION_BADGE[model.privacyTier] ?? model.privacyTier;
  }

  protected hostingLabel(model: Model): string {
    const region = model.hostingRegion?.trim();
    if (region) {
      return region.charAt(0).toUpperCase() + region.slice(1);
    }
    return model.hostingCountry?.trim() ?? '';
  }

  // Human-friendly context window, e.g. 128000 → "128K", 1000000 → "1M".
  protected formatContext(tokens: number): string {
    if (tokens >= 1_000_000) {
      const millions = tokens / 1_000_000;
      return `${Number.isInteger(millions) ? millions : millions.toFixed(1)}M`;
    }
    if (tokens >= 1000) {
      return `${Math.round(tokens / 1000)}K`;
    }
    return `${tokens}`;
  }

  // Models eligible at a candidate tier = those whose own tier is at or below it
  // (ch_only ⊆ eu ⊆ global). Computed from the catalogue we already hold.
  protected modelCountForTier(tier: PrivacyTier): number {
    return this._models
      .modelList()
      .filter((model) => TIER_RANK[model.privacyTier] <= TIER_RANK[tier]).length;
  }

  protected selectTier(tier: PrivacyTier): void {
    if (this.saving() || tier === this.currentTier()) {
      return;
    }

    this.saving.set(true);
    this._auth.setPrivacyTier(tier).subscribe({
      next: () => this.saving.set(false),
      error: () => this.saving.set(false),
    });
  }
}
