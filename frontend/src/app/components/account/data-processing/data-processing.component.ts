import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';

import { CognosIconComponent, CognosLozengeComponent } from '@cognos/ui-angular';
import type { CognosIconName } from '@cognos/ui/icons';

import { PrivacyTier } from '@app/interfaces/model';
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
            changes which models you can use — it has no effect on what we keep, because
            we keep nothing.
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
              <span class="data-processing__tier-count"
                >{{ modelCountForTier(tier.id) }} models</span
              >
              <span class="data-processing__tier-note">{{ tier.note }}</span>
            </span>
          </button>
        }
      </div>

      <div class="data-processing__retention">
        <cog-icon name="shield-check" [size]="18" tone="success" />
        <div>
          <p class="data-processing__retention-title">Zero retention — every region</p>
          <p class="data-processing__retention-body">
            Cognos never stores your prompts or responses anywhere. This setting only
            controls the jurisdiction your messages pass through while a model answers,
            and which models that makes available.
          </p>
        </div>
      </div>
    </section>
  `,
  styles: `
    :host {
      display: block;
    }

    .data-processing {
      display: grid;
      gap: var(--cog-space-200);
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
      gap: var(--cog-space-125);
    }

    .data-processing__tier {
      display: grid;
      gap: var(--cog-space-100);
      align-content: start;
      border: 2px solid var(--cog-border);
      border-radius: var(--cog-radius-md);
      background: var(--cog-surface);
      padding: var(--cog-space-150);
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
      align-items: baseline;
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
  `,
})
export class DataProcessingComponent {
  private readonly _models = inject(ModelService);
  private readonly _auth = inject(AuthService);

  protected readonly tiers = TIER_OPTIONS;
  protected readonly saving = signal(false);

  protected readonly currentTier = this._models.privacyTier;
  protected readonly currentBadge = computed(() => TIER_BADGE[this.currentTier()]);

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
