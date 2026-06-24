import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';

import { CognosIconComponent, CognosLozengeComponent } from '@cognos/ui-angular';
import type { CognosIconName } from '@cognos/ui/icons';

import { localizedModelDescription } from '@app/i18n/model-copy';
import { Model, PrivacyTier } from '@app/interfaces/model';
import { AuthService } from '@app/services/auth.service';
import { ModelService } from '@app/services/model.service';
import { UserPreferencesService } from '@app/services/user-preferences.service';
import { deriveModelCostTier } from '@app/utils/model-cost-tier';
import {
  MODEL_FILTER_CHIPS,
  QuickFilter,
  buildSearchSynonyms,
  matchesQuickFilter,
  modelMatchesSearch,
} from '@app/utils/model-discovery';

interface TierOption {
  id: PrivacyTier;
  icon: CognosIconName;
}

// Ordered most-restrictive first, matching how residency is presented to the
// user (Switzerland → Europe → Global). The localised name/blurb/note live in
// the catalog under `account.dataProcessing.tiers.<id>.*`.
const TIER_OPTIONS: TierOption[] = [
  { id: 'ch_only', icon: 'shield-check' },
  { id: 'eu', icon: 'landmark' },
  { id: 'global', icon: 'cloud' },
];

const TIER_RANK: Record<PrivacyTier, number> = { ch_only: 0, eu: 1, global: 2 };

// i18n key suffixes for the tier residency badge.
const TIER_BADGE_KEY: Record<PrivacyTier, string> = {
  ch_only: 'ch_only',
  eu: 'eu',
  global: 'global',
};

// i18n key suffixes for the short residency label on each model row.
const MODEL_REGION_BADGE_KEY: Record<PrivacyTier, string> = {
  ch_only: 'ch_only',
  eu: 'eu',
  global: 'global',
};

// DataProcessingComponent lets the user choose where their messages may be
// processed (the privacy tier), which is the single control over model
// eligibility. Selecting a tier patches the user record; the model catalogue
// re-fetches and eligibility updates reactively.
@Component({
  selector: 'app-data-processing',
  standalone: true,
  imports: [CognosIconComponent, CognosLozengeComponent, TranslocoModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section
      *transloco="let t"
      class="data-processing"
      aria-labelledby="data-processing-heading"
    >
      <header class="data-processing__head">
        <span class="data-processing__head-icon">
          <cog-icon name="server" [size]="18" tone="current" />
        </span>
        <div class="data-processing__head-text">
          <h2 id="data-processing-heading" class="data-processing__title">
            {{ t('account.dataProcessing.title') }}
          </h2>
          <p class="data-processing__subtitle">
            {{ t('account.dataProcessing.subtitle') }}
          </p>
        </div>
        <cog-lozenge tone="green">{{ currentBadge() }}</cog-lozenge>
      </header>

      <div
        class="data-processing__tiers"
        role="radiogroup"
        [attr.aria-label]="t('account.dataProcessing.regionAria')"
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
            <span class="data-processing__tier-name">{{
              t('account.dataProcessing.tiers.' + tier.id + '.name')
            }}</span>
            <span class="data-processing__tier-blurb">{{
              t('account.dataProcessing.tiers.' + tier.id + '.blurb')
            }}</span>
            <span class="data-processing__tier-foot">
              <cog-lozenge tone="neutral">{{
                t('account.dataProcessing.modelCount', {
                  count: modelCountForTier(tier.id),
                })
              }}</cog-lozenge>
              <span class="data-processing__tier-note">{{
                t('account.dataProcessing.tiers.' + tier.id + '.note')
              }}</span>
            </span>
          </button>
        }
      </div>

      <div class="data-processing__retention">
        <cog-icon name="shield-check" [size]="18" tone="success" />
        <div>
          <p class="data-processing__retention-title">
            {{ t('account.dataProcessing.retentionTitle') }}
          </p>
          <p class="data-processing__retention-body">
            {{ t('account.dataProcessing.retentionBody') }}
          </p>
        </div>
      </div>

      <section class="models" aria-labelledby="models-heading">
        <header class="models__head">
          <h3 id="models-heading" class="models__title">
            {{ t('account.dataProcessing.modelsAvailable') }}
            <cog-lozenge tone="neutral">{{
              t('account.dataProcessing.modelsOf', {
                eligible: eligibleCount(),
                total: totalCount(),
              })
            }}</cog-lozenge>
          </h3>
          <span class="models__region">{{ currentBadge() }}</span>
        </header>

        <p class="models__hint">{{ t('account.dataProcessing.manageHint') }}</p>

        <label class="models__search">
          <cog-icon name="search" [size]="16" tone="text-subtle" />
          <input
            type="text"
            class="models__search-input"
            autocomplete="off"
            [attr.aria-label]="t('account.dataProcessing.modelsAvailable')"
            [placeholder]="t('chat.models.search.placeholder')"
            [value]="searchQuery()"
            (input)="onSearch($event)"
          />
        </label>

        <div
          class="models__chips"
          role="group"
          [attr.aria-label]="t('account.dataProcessing.modelsAvailable')"
        >
          @for (chip of filterChips; track chip.key) {
            <button
              type="button"
              class="models__chip"
              [class.models__chip--active]="activeFilter() === chip.key"
              [attr.aria-pressed]="activeFilter() === chip.key"
              (click)="toggleFilter(chip.key)"
            >
              {{ t(chip.labelKey) }}
            </button>
          }
          @if (hiddenModelsCount() > 0) {
            <button type="button" class="models__reset" (click)="resetHidden()">
              <cog-icon name="rotate-cw" [size]="14" tone="current" />
              {{ t('account.dataProcessing.resetHidden') }}
            </button>
          }
        </div>

        <ul class="models__list">
          @for (model of visibleModels(); track model.id) {
            <li
              class="models__row"
              [class.models__row--locked]="!model.isEligible"
              [class.models__row--hidden]="isHidden(model.id)"
            >
              <span class="models__icon">
                <cog-icon
                  [name]="model.isEligible ? 'server' : 'lock'"
                  [size]="16"
                  tone="current"
                />
              </span>
              <span class="models__body">
                <span class="models__name">
                  {{ model.name }}
                  @if (isDefault(model)) {
                    <cog-lozenge tone="green">{{
                      t('account.dataProcessing.defaultBadge')
                    }}</cog-lozenge>
                  }
                  @if (isHidden(model.id)) {
                    <cog-lozenge tone="neutral">{{
                      t('account.dataProcessing.hiddenBadge')
                    }}</cog-lozenge>
                  }
                </span>
                <span class="models__desc">{{ describe(model, t) }}</span>
              </span>
              <span class="models__meta">
                <cog-lozenge [tone]="model.isEligible ? 'green' : 'neutral'">
                  {{ regionBadge(model) }}
                </cog-lozenge>
                @if (model.isEligible) {
                  <span class="models__context">{{
                    t('account.dataProcessing.context', {
                      size: formatContext(model.inputContextLength),
                    })
                  }}</span>
                } @else {
                  <span class="models__locked">
                    <cog-icon name="lock" [size]="12" tone="current" />
                    {{
                      model.ineligibilityReason ||
                        t('account.dataProcessing.needsBroaderRegion')
                    }}
                  </span>
                }
              </span>
              <span class="models__actions">
                <button
                  type="button"
                  class="models__action models__action--pin"
                  [class.models__action--on]="isPinned(model.id)"
                  [attr.aria-pressed]="isPinned(model.id)"
                  [attr.title]="
                    isPinned(model.id) ? t('chat.models.unpin') : t('chat.models.pin')
                  "
                  (click)="togglePin(model.id)"
                >
                  <cog-icon name="pin" [size]="14" tone="current" />
                </button>
                <button
                  type="button"
                  class="models__action models__action--text"
                  (click)="toggleHidden(model.id)"
                >
                  {{
                    isHidden(model.id)
                      ? t('account.dataProcessing.unhideModel')
                      : t('account.dataProcessing.hideModel')
                  }}
                </button>
              </span>
            </li>
          } @empty {
            <li class="models__empty">{{ t('chat.models.search.noResults') }}</li>
          }
        </ul>

        @if (!isFiltering() && orderedModels().length > collapsedLimit) {
          <button
            type="button"
            class="models__show-more"
            [class.models__show-more--open]="expanded()"
            (click)="toggleExpanded()"
            [attr.aria-expanded]="expanded()"
          >
            <cog-icon name="chevron-down" [size]="14" tone="current" />
            {{
              expanded()
                ? t('account.dataProcessing.showLess')
                : t('account.dataProcessing.showMore', { count: hiddenCount() })
            }}
          </button>
        }

        @if (lockedCount() > 0) {
          <p class="models__footnote">
            <cog-icon name="lock" [size]="14" tone="current" />
            {{
              lockedCount() === 1
                ? t('account.dataProcessing.footnoteOne', { count: lockedCount() })
                : t('account.dataProcessing.footnoteMany', { count: lockedCount() })
            }}
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
      grid-template-columns: 32px minmax(0, 1fr) auto auto;
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

    .models__row--hidden {
      opacity: 0.6;
    }

    .models__name {
      display: inline-flex;
      align-items: center;
      gap: var(--cog-space-075);
      flex-wrap: wrap;
    }

    .models__hint {
      margin: 0;
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-caption);
    }

    .models__search {
      display: flex;
      align-items: center;
      gap: var(--cog-space-075);
      padding: 0 var(--cog-space-100);
      border: 1px solid var(--cog-border);
      border-radius: var(--cog-radius-sm);
      background: var(--cog-surface-raised, var(--cog-surface));
    }

    .models__search:focus-within {
      border-color: var(--cog-brand);
    }

    .models__search-input {
      flex: 1 1 auto;
      border: 0;
      background: transparent;
      padding: var(--cog-space-100) 0;
      color: var(--cog-text);
      font: inherit;
    }

    .models__search-input:focus {
      outline: 0;
    }

    .models__chips {
      display: flex;
      flex-wrap: wrap;
      gap: var(--cog-space-075);
    }

    .models__chip {
      display: inline-flex;
      align-items: center;
      min-height: 32px;
      padding: 0 var(--cog-space-100);
      border: 1px solid var(--cog-border);
      border-radius: var(--cog-radius-pill, 999px);
      background: var(--cog-surface);
      color: var(--cog-text-subtle);
      font: inherit;
      font-size: var(--cog-fs-caption);
      cursor: pointer;
    }

    .models__chip--active {
      border-color: var(--cog-brand);
      background: var(--cog-selected-bg, rgba(46, 160, 67, 0.12));
      color: var(--cog-brand);
      font-weight: var(--cog-fw-semibold);
    }

    .models__reset {
      display: inline-flex;
      align-items: center;
      gap: var(--cog-space-050, 4px);
      margin-left: auto;
      border: 0;
      background: transparent;
      color: var(--cog-text-subtle);
      font: inherit;
      font-size: var(--cog-fs-caption);
      cursor: pointer;
    }

    .models__reset:hover {
      color: var(--cog-text);
    }

    .models__actions {
      display: inline-flex;
      align-items: center;
      gap: var(--cog-space-075);
    }

    .models__action {
      border: 0;
      background: transparent;
      cursor: pointer;
      font: inherit;
    }

    .models__action--pin {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border-radius: var(--cog-radius-xs);
      color: var(--cog-text-subtlest);
    }

    .models__action--pin:hover {
      color: var(--cog-text);
    }

    .models__action--on {
      color: var(--cog-brand);
    }

    .models__action--text {
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-caption);
      text-decoration: underline;
      text-underline-offset: 2px;
    }

    .models__action--text:hover {
      color: var(--cog-text);
    }

    .models__empty {
      padding: var(--cog-space-200) var(--cog-space-050);
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-caption);
      text-align: center;
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

    .models__show-more {
      display: inline-flex;
      align-items: center;
      gap: var(--cog-space-050);
      margin: var(--cog-space-100) auto 0;
      border: 0;
      background: transparent;
      padding: var(--cog-space-075) var(--cog-space-100);
      color: var(--cog-text-subtle);
      font: inherit;
      font-size: var(--cog-fs-caption);
      font-weight: var(--cog-fw-semibold);
      cursor: pointer;
      border-radius: var(--cog-radius-sm);
    }

    .models__show-more:hover {
      color: var(--cog-text);
      background: var(--cog-surface-raised, rgba(0, 0, 0, 0.04));
    }

    .models__show-more cog-icon {
      display: inline-flex;
      transition: transform var(--cog-dur-fast) var(--cog-ease-standard);
    }

    .models__show-more--open cog-icon {
      transform: rotate(180deg);
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
  private readonly _transloco = inject(TranslocoService);
  private readonly _preferences = inject(UserPreferencesService);

  protected readonly tiers = TIER_OPTIONS;
  protected readonly saving = signal(false);

  protected readonly currentTier = this._models.privacyTier;
  protected readonly currentBadge = computed(() =>
    this._transloco.translate(
      'account.dataProcessing.badge.' + TIER_BADGE_KEY[this.currentTier()],
    ),
  );

  private readonly _modelList = this._models.modelList;
  protected readonly totalCount = computed(() => this._modelList().length);
  protected readonly eligibleCount = computed(
    () => this._modelList().filter((model) => model.isEligible).length,
  );
  protected readonly lockedCount = computed(
    () => this.totalCount() - this.eligibleCount(),
  );

  // Search + quick-filter state. The settings list shares the composer's pure
  // discovery logic (model-discovery), but presents a fuller management view.
  protected readonly searchQuery = signal('');
  protected readonly activeFilter = signal<QuickFilter | null>(null);
  protected readonly filterChips = MODEL_FILTER_CHIPS;

  private readonly _synonyms = buildSearchSynonyms(
    this._transloco.translateObject('chat.models.synonyms') ?? {},
  );

  protected readonly isFiltering = computed(
    () => !!this.searchQuery().trim() || this.activeFilter() !== null,
  );

  // The catalogue filtered by search + quick filter, eligible-first then locked
  // (matching the existing mock). Hidden models stay in the list — settings is
  // where the user manages them — but are tagged and offer an Unhide action.
  protected readonly orderedModels = computed(() => {
    const filter = this.activeFilter();
    const query = this.searchQuery();
    return [...this._modelList()]
      .filter(
        (model) =>
          matchesQuickFilter(model, filter) &&
          modelMatchesSearch(model, query, {
            costTierLabel: (m) =>
              this._transloco.translate(
                'chat.models.costTier.' + deriveModelCostTier(m.pricing),
              ),
            synonyms: this._synonyms,
          }),
      )
      .sort((a, b) => Number(b.isEligible) - Number(a.isEligible));
  });

  // Collapse the (long) catalogue to the first few rows when not filtering;
  // a search/filter shows every match so nothing hides behind "show more".
  protected readonly collapsedLimit = 5;
  protected readonly expanded = signal(false);
  protected readonly visibleModels = computed(() =>
    this.expanded() || this.isFiltering()
      ? this.orderedModels()
      : this.orderedModels().slice(0, this.collapsedLimit),
  );
  protected readonly hiddenCount = computed(() =>
    Math.max(0, this.orderedModels().length - this.collapsedLimit),
  );

  // Count of models the user has actively hidden (drives the reset control).
  protected readonly hiddenModelsCount = computed(
    () => this._preferences.hiddenModels().length,
  );

  protected readonly selectedModelId = computed(() => this._models.selectedModel().id);

  protected onSearch(event: Event): void {
    this.searchQuery.set((event.target as HTMLInputElement).value);
  }

  protected toggleFilter(filter: QuickFilter): void {
    this.activeFilter.update((current) => (current === filter ? null : filter));
  }

  protected isPinned(modelId: string): boolean {
    return this._preferences.isModelPinned(modelId);
  }

  protected isHidden(modelId: string): boolean {
    return this._preferences.isModelHidden(modelId);
  }

  protected isDefault(model: Model): boolean {
    return model.isEligible && model.id === this.selectedModelId();
  }

  protected togglePin(modelId: string): void {
    if (this.isPinned(modelId)) {
      this._preferences.unpinModel(modelId);
    } else {
      this._preferences.pinModel(modelId);
    }
  }

  protected toggleHidden(modelId: string): void {
    if (this.isHidden(modelId)) {
      this._preferences.unhideModel(modelId);
    } else {
      this._preferences.hideModel(modelId);
    }
  }

  protected resetHidden(): void {
    this._preferences.resetHiddenModels();
  }

  protected toggleExpanded(): void {
    this.expanded.update((open) => !open);
  }

  // Localised per-model description (falls back to the catalogue description).
  protected readonly describe = localizedModelDescription;

  protected regionBadge(model: Model): string {
    const key = MODEL_REGION_BADGE_KEY[model.privacyTier];
    return key
      ? this._transloco.translate('account.dataProcessing.regionBadge.' + key)
      : model.privacyTier;
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
