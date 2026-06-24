import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  Output,
  afterNextRender,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';

import { CognosIconComponent, CognosLozengeComponent } from '@cognos/ui-angular';

import { Model } from '@app/interfaces/model';
import { BillingService } from '@app/services/billing.service';
import { ModelService } from '@app/services/model.service';
import { UserPreferencesService } from '@app/services/user-preferences.service';
import { modelCapabilityMetadata } from '@app/utils/model-capability-metadata';
import { ModelCostTier, deriveModelCostTier } from '@app/utils/model-cost-tier';
import {
  QuickFilter,
  buildSearchSynonyms,
  flattenGroups,
  formatContextWindow,
  modelStrengthPills,
  modelSupportsCapability,
  orderModels,
} from '@app/utils/model-discovery';

// Re-exported so existing imports keep working; the implementation now lives in
// the shared discovery util used by both the composer and account settings.
export { modelSupportsCapability } from '@app/utils/model-discovery';

// How the selector is presented. The same content renders as a compact dropdown
// on desktop and a bottom-sheet on mobile (spec §4.5); only the chrome differs.
export type ModelSelectorLayout = 'dropdown' | 'sheet';

interface FilterChip {
  key: QuickFilter;
  labelKey: string;
}

@Component({
  selector: 'app-model-selector',
  standalone: true,
  imports: [
    CommonModule,
    CognosIconComponent,
    CognosLozengeComponent,
    RouterLink,
    TranslocoModule,
  ],
  template: `
    <div
      class="model-selector"
      [class.model-selector--sheet]="layout() === 'sheet'"
      *transloco="let t"
    >
      @if (layout() === 'sheet') {
        <header class="model-selector__sheet-head">
          <span class="model-selector__grip" aria-hidden="true"></span>
          <h2 class="model-selector__sheet-title">{{ t('chat.models.pickAria') }}</h2>
          <button
            type="button"
            class="model-selector__close"
            [attr.aria-label]="t('common.close')"
            (click)="closed.emit()"
          >
            <cog-icon name="x" [size]="18" tone="current" />
          </button>
        </header>
      }

      <!-- Scrollable, grouped model list (top). -->
      <div
        class="model-selector__list"
        role="listbox"
        [attr.aria-label]="t('chat.models.pickAria')"
      >
        @for (group of groups(); track group.key) {
          @if (group.models.length) {
            @if (group.key !== 'other') {
              <p class="model-selector__section">
                {{ t('chat.models.sections.' + group.key) }}
              </p>
            }
            @for (model of group.models; track model.id) {
              <div class="model-selector__row-wrap">
                <button
                  type="button"
                  role="option"
                  class="model-selector__row"
                  [class.model-selector__row--active]="model.id === selectedModelId()"
                  [class.model-selector__row--disabled]="!model.isEligible"
                  [attr.aria-selected]="model.id === selectedModelId()"
                  [disabled]="!model.isEligible"
                  (click)="onSelectModel(model)"
                >
                  <span class="model-selector__body">
                    <span class="model-selector__heading">
                      <span class="model-selector__name">{{ model.name }}</span>
                      @if (!hideCost()) {
                        <cog-lozenge
                          class="model-selector__cost"
                          [tone]="costTierTone(model)"
                          [attr.title]="
                            t('chat.models.estimatedCost', {
                              cost: t('chat.models.costTier.' + costTier(model)),
                            })
                          "
                        >
                          {{ t('chat.models.costTier.' + costTier(model)) }}
                        </cog-lozenge>
                      }
                    </span>

                    @if (strengthPills(model).length) {
                      <span class="model-selector__pills">
                        @for (key of strengthPills(model); track key) {
                          <span class="model-selector__pill">
                            {{ t('chat.models.strengths.' + key) }}
                          </span>
                        }
                      </span>
                    }

                    <span class="model-selector__meta">
                      {{ metaLine(model, t) }}
                    </span>

                    @if (!model.isEligible && model.ineligibilityReason) {
                      <span class="model-selector__reason">{{
                        model.ineligibilityReason
                      }}</span>
                    }
                  </span>

                  @if (model.id === selectedModelId()) {
                    <cog-icon
                      class="model-selector__check"
                      name="check"
                      [size]="16"
                      tone="success"
                    />
                  }
                </button>

                <button
                  type="button"
                  class="model-selector__pin-button"
                  [class.model-selector__pin-button--pinned]="isPinned(model.id)"
                  [attr.title]="
                    isPinned(model.id) ? t('chat.models.unpin') : t('chat.models.pin')
                  "
                  [attr.aria-pressed]="isPinned(model.id)"
                  (click)="onTogglePin($event, model)"
                >
                  <cog-icon name="pin" [size]="14" tone="current" />
                </button>
              </div>
            }
          }
        }

        @if (isEmpty()) {
          <div class="model-selector__empty">
            <p>{{ t('chat.models.search.noResults') }}</p>
            @if (hasHiddenMatches() && !showHidden()) {
              <button
                type="button"
                class="model-selector__link"
                (click)="showHidden.set(true)"
              >
                {{ t('chat.models.search.showHidden') }}
              </button>
            }
          </div>
        }
      </div>

      <!-- Controls (bottom): search, privacy note, filter rail, settings link. -->
      <div class="model-selector__controls">
        <label class="model-selector__search">
          <cog-icon name="search" [size]="16" tone="text-subtle" />
          <input
            #searchInput
            type="text"
            class="model-selector__search-input"
            autocomplete="off"
            [attr.aria-label]="t('chat.models.pickAria')"
            [placeholder]="t('chat.models.search.placeholder')"
            [value]="searchQuery()"
            (input)="onSearch($event)"
          />
        </label>

        <p class="model-selector__privacy">
          <cog-icon name="shield-check" [size]="12" tone="text-subtle" />
          {{ t('chat.models.search.privacyNote') }}
        </p>

        <div
          class="model-selector__chips"
          role="group"
          [attr.aria-label]="t('chat.models.pickAria')"
        >
          @for (chip of filterChips; track chip.key) {
            <button
              type="button"
              class="model-selector__chip"
              [class.model-selector__chip--active]="activeFilter() === chip.key"
              [attr.aria-pressed]="activeFilter() === chip.key"
              (click)="toggleFilter(chip.key)"
            >
              {{ t(chip.labelKey) }}
            </button>
          }
        </div>

        <a class="model-selector__manage" routerLink="/account" (click)="closed.emit()">
          <cog-icon name="settings" [size]="14" tone="current" />
          {{ t('chat.models.manageInSettings') }}
        </a>
      </div>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }

    .model-selector {
      display: flex;
      flex-direction: column;
      width: min(420px, calc(100vw - var(--cog-space-200)));
      max-height: min(540px, calc(100vh - 120px));
      border: 1px solid var(--cog-border);
      border-radius: var(--cog-radius-md);
      background: var(--cog-surface-raised);
      box-shadow: var(--cog-shadow-overlay, 0 10px 30px rgba(0, 0, 0, 0.12));
      overflow: hidden;
    }

    /* Mobile: a full-width bottom sheet pinned to the viewport bottom. */
    .model-selector--sheet {
      width: 100vw;
      max-height: 85vh;
      border-radius: var(--cog-radius-lg) var(--cog-radius-lg) 0 0;
      border: 0;
    }

    .model-selector__sheet-head {
      display: grid;
      grid-template-columns: 1fr auto;
      align-items: center;
      gap: var(--cog-space-100);
      padding: var(--cog-space-150) var(--cog-space-150) var(--cog-space-100);
      position: relative;
    }

    .model-selector__grip {
      position: absolute;
      top: var(--cog-space-075);
      left: 50%;
      transform: translateX(-50%);
      width: 36px;
      height: 4px;
      border-radius: 999px;
      background: var(--cog-border);
    }

    .model-selector__sheet-title {
      margin: 0;
      font-size: var(--cog-fs-title);
      font-weight: var(--cog-fw-semibold);
    }

    .model-selector__close {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 32px;
      height: 32px;
      border: 0;
      border-radius: var(--cog-radius-sm);
      background: transparent;
      color: var(--cog-text-subtle);
      cursor: pointer;
    }

    .model-selector__list {
      flex: 1 1 auto;
      overflow-y: auto;
      padding: var(--cog-space-075);
    }

    .model-selector__section {
      display: flex;
      align-items: center;
      gap: var(--cog-space-075);
      margin: var(--cog-space-075) 0 var(--cog-space-025);
      padding: 0 var(--cog-space-075);
      color: var(--cog-text-subtlest);
      font-size: var(--cog-fs-caption);
      font-weight: var(--cog-fw-semibold);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .model-selector__row-wrap {
      position: relative;
    }

    .model-selector__row {
      display: grid;
      grid-template-columns: minmax(0, 1fr) auto;
      align-items: center;
      gap: var(--cog-space-100);
      width: 100%;
      border: 0;
      background: transparent;
      border-radius: var(--cog-radius-sm);
      padding: var(--cog-space-100);
      padding-right: 40px;
      text-align: left;
      cursor: pointer;
      color: var(--cog-text);
      font: inherit;
      min-height: 44px;
      transition: background-color var(--cog-dur-fast) var(--cog-ease-standard);
    }

    .model-selector__row:hover,
    .model-selector__row:focus-visible {
      background: var(--cog-surface-hover, rgba(0, 0, 0, 0.04));
      outline: 0;
    }

    .model-selector__row--active {
      background: var(--cog-selected-bg, rgba(46, 160, 67, 0.12));
    }

    .model-selector__row--disabled {
      cursor: not-allowed;
      opacity: 0.72;
    }

    .model-selector__body {
      display: grid;
      gap: var(--cog-space-050, 4px);
      min-width: 0;
    }

    .model-selector__heading {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--cog-space-075);
      min-width: 0;
    }

    .model-selector__name {
      font-size: var(--cog-fs-body);
      font-weight: var(--cog-fw-semibold);
      line-height: var(--cog-lh-body);
    }

    .model-selector__pills {
      display: inline-flex;
      flex-wrap: wrap;
      gap: var(--cog-space-050, 4px);
    }

    .model-selector__pill {
      padding: 1px var(--cog-space-075);
      border-radius: var(--cog-radius-xs);
      background: var(--cog-surface-sunken, rgba(0, 0, 0, 0.05));
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-caption);
      line-height: 1.6;
    }

    .model-selector__meta {
      color: var(--cog-text-subtlest);
      font-size: var(--cog-fs-caption);
      line-height: var(--cog-lh-caption);
    }

    .model-selector__reason {
      color: var(--cog-text-subtlest);
      font-size: var(--cog-fs-caption);
    }

    .model-selector__check {
      align-self: center;
    }

    .model-selector__pin-button {
      position: absolute;
      top: 50%;
      transform: translateY(-50%);
      right: var(--cog-space-075);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 28px;
      height: 28px;
      border: 0;
      border-radius: var(--cog-radius-xs);
      background: transparent;
      color: var(--cog-text-subtlest);
      cursor: pointer;
      opacity: 0;
      transition: opacity var(--cog-dur-fast) var(--cog-ease-standard);
    }

    .model-selector__row-wrap:hover .model-selector__pin-button,
    .model-selector__row-wrap:focus-within .model-selector__pin-button,
    .model-selector__pin-button--pinned,
    .model-selector--sheet .model-selector__pin-button {
      opacity: 1;
    }

    .model-selector__pin-button--pinned {
      color: var(--cog-brand);
    }

    .model-selector__empty {
      padding: var(--cog-space-200) var(--cog-space-100);
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-caption);
      text-align: center;
    }

    .model-selector__controls {
      flex: 0 0 auto;
      display: grid;
      gap: var(--cog-space-075);
      padding: var(--cog-space-100);
      border-top: 1px solid var(--cog-border);
      background: var(--cog-surface-raised);
    }

    .model-selector__search {
      display: flex;
      align-items: center;
      gap: var(--cog-space-075);
      padding: 0 var(--cog-space-100);
      border: 1px solid var(--cog-border);
      border-radius: var(--cog-radius-sm);
      background: var(--cog-surface);
    }

    .model-selector__search:focus-within {
      border-color: var(--cog-brand);
    }

    .model-selector__search-input {
      flex: 1 1 auto;
      border: 0;
      background: transparent;
      padding: var(--cog-space-100) 0;
      color: var(--cog-text);
      font: inherit;
      min-height: 44px;
    }

    .model-selector__search-input:focus {
      outline: 0;
    }

    .model-selector__privacy {
      display: flex;
      align-items: center;
      gap: var(--cog-space-050, 4px);
      margin: 0;
      color: var(--cog-text-subtlest);
      font-size: var(--cog-fs-caption);
    }

    .model-selector__chips {
      display: flex;
      gap: var(--cog-space-075);
      overflow-x: auto;
      scrollbar-width: none;
      padding-bottom: 2px;
    }

    .model-selector__chips::-webkit-scrollbar {
      display: none;
    }

    .model-selector__chip {
      flex: 0 0 auto;
      display: inline-flex;
      align-items: center;
      min-height: 32px;
      padding: 0 var(--cog-space-100);
      border: 1px solid var(--cog-border);
      border-radius: 999px;
      background: var(--cog-surface);
      color: var(--cog-text-subtle);
      font: inherit;
      font-size: var(--cog-fs-caption);
      cursor: pointer;
      white-space: nowrap;
    }

    .model-selector__chip--active {
      border-color: var(--cog-brand);
      background: var(--cog-selected-bg, rgba(46, 160, 67, 0.12));
      color: var(--cog-brand);
      font-weight: var(--cog-fw-semibold);
    }

    .model-selector__manage,
    .model-selector__link {
      display: inline-flex;
      align-items: center;
      gap: var(--cog-space-075);
      border: 0;
      background: transparent;
      color: var(--cog-text-subtle);
      font: inherit;
      font-size: var(--cog-fs-caption);
      cursor: pointer;
      text-decoration: none;
    }

    .model-selector__manage:hover,
    .model-selector__link:hover {
      color: var(--cog-text);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  // Keyboard nav is handled at the host so no non-focusable template element
  // carries an interaction handler (a11y lint); key events bubble up from rows.
  host: { '(keydown)': 'onKeydown($event)' },
})
export class ModelSelectorComponent {
  private readonly _modelService = inject(ModelService);
  private readonly _preferences = inject(UserPreferencesService);
  private readonly _billing = inject(BillingService);
  private readonly _transloco = inject(TranslocoService);
  private readonly _host = inject<ElementRef<HTMLElement>>(ElementRef);

  // Layout chrome differs (sheet header vs bare dropdown) but content is shared.
  readonly layout = input<ModelSelectorLayout>('dropdown');

  // Restrict the list to models supporting an active composer tool (image gen).
  readonly requiredCapability = input<'image_generation' | null>(null);

  @Output() readonly modelSelected = new EventEmitter<Model>();
  // Asked to close (sheet X / Escape / settings link). The host owns open state.
  @Output() readonly closed = new EventEmitter<void>();

  protected readonly filterChips: FilterChip[] = [
    { key: 'recommended', labelKey: 'chat.models.filters.recommended' },
    { key: 'fast', labelKey: 'chat.models.filters.fast' },
    { key: 'powerful', labelKey: 'chat.models.filters.powerful' },
    { key: 'low_cost', labelKey: 'chat.models.filters.lowCost' },
    { key: 'reasoning', labelKey: 'chat.models.filters.reasoning' },
    { key: 'image', labelKey: 'chat.models.filters.image' },
    { key: 'vision', labelKey: 'chat.models.filters.vision' },
    { key: 'long_context', labelKey: 'chat.models.filters.longContext' },
  ];

  // Frozen on open so rows don't jump while interacting (spec §7). The selector
  // is created fresh each time it opens, so these snapshots are per-open.
  private readonly _pinned: readonly string[] = [...this._preferences.pinnedModels()];
  private readonly _recent: readonly string[] = [...this._preferences.recentModels()];
  private readonly _hidden = new Set(this._preferences.hiddenModels());

  protected readonly searchQuery = signal('');
  protected readonly activeFilter = signal<QuickFilter | null>('recommended');
  protected readonly showHidden = signal(false);

  // Localised synonym map, built once from the active language's i18n catalogue.
  private readonly _synonyms = buildSearchSynonyms(
    this._transloco.translateObject('chat.models.synonyms') ?? {},
  );

  readonly selectedModelId = computed(() => this._modelService.selectedModel().id);

  protected readonly hideCost = computed(() => this._billing.isUnlimited());

  // Whether any eligible, non-hidden model is recommended under the current
  // capability. If none, we drop the default Recommended chip so the list isn't
  // empty for a tier without recommendations.
  private readonly recommendedAvailable = computed(() =>
    this._modelService
      .modelList()
      .some(
        (model) =>
          modelSupportsCapability(model, this.requiredCapability()) &&
          !this._hidden.has(model.id) &&
          modelCapabilityMetadata(model.id).recommended,
      ),
  );

  protected readonly groups = computed(() =>
    orderModels({
      models: this._modelService.modelList(),
      pinnedIds: this._pinned,
      recentIds: this._recent,
      hiddenIds: [...this._hidden],
      requiredCapability: this.requiredCapability(),
      quickFilter: this.activeFilter(),
      query: this.searchQuery(),
      showHidden: this.showHidden(),
      searchContext: {
        costTierLabel: (model) =>
          this._transloco.translate('chat.models.costTier.' + this.costTier(model)),
        synonyms: this._synonyms,
        extraTerms: (model) => [
          this._transloco.translate(
            'account.dataProcessing.regionBadge.' + model.privacyTier,
          ),
        ],
      },
    }),
  );

  protected readonly isEmpty = computed(
    () => flattenGroups(this.groups()).length === 0,
  );

  // Are there hidden models that match the current query (so we can offer
  // "show hidden matches")? Only meaningful when results are otherwise empty.
  protected readonly hasHiddenMatches = computed(() => {
    if (this._hidden.size === 0) {
      return false;
    }
    return (
      flattenGroups(
        orderModels({
          models: this._modelService.modelList(),
          pinnedIds: this._pinned,
          recentIds: this._recent,
          hiddenIds: [...this._hidden],
          requiredCapability: this.requiredCapability(),
          quickFilter: this.activeFilter(),
          query: this.searchQuery(),
          showHidden: true,
          searchContext: { synonyms: this._synonyms },
        }),
      ).length > 0
    );
  });

  constructor() {
    // Drop the default Recommended chip when nothing recommended is available.
    effect(() => {
      if (this.activeFilter() === 'recommended' && !this.recommendedAvailable()) {
        this.activeFilter.set(null);
      }
    });

    // Focus the search input on open — desktop only, so the on-screen keyboard
    // doesn't cover the list on mobile (spec §4.4/§4.5).
    afterNextRender(() => {
      if (this.layout() === 'dropdown') {
        this._host.nativeElement
          .querySelector<HTMLInputElement>('.model-selector__search-input')
          ?.focus();
      }
    });
  }

  protected onSearch(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.searchQuery.set(value);
    // Typing overrides the default Recommended chip so a name search isn't
    // narrowed to recommendations (spec §5.3). An explicitly chosen chip stays.
    if (value && this.activeFilter() === 'recommended') {
      this.activeFilter.set(null);
    }
  }

  protected toggleFilter(filter: QuickFilter): void {
    this.activeFilter.update((current) => (current === filter ? null : filter));
  }

  protected costTier(model: Model): ModelCostTier {
    return deriveModelCostTier(model.pricing);
  }

  protected costTierTone(model: Model): 'green' | 'blue' | 'red' {
    const tones: Record<ModelCostTier, 'green' | 'blue' | 'red'> = {
      low: 'green',
      medium: 'blue',
      high: 'red',
    };
    return tones[this.costTier(model)];
  }

  protected strengthPills(model: Model): string[] {
    // Cap at four so rows stay scannable on narrow widths.
    return modelStrengthPills(model).slice(0, 4);
  }

  protected metaLine(
    model: Model,
    t: (key: string, params?: object) => string,
  ): string {
    const context = t('account.dataProcessing.context', {
      size: formatContextWindow(model.inputContextLength),
    });
    return `${context} · ${this.regionFlag(model)}`;
  }

  // A compact flag for the hosting region, replacing the country code to save
  // space. Falls back to a globe for non-CH/EU hosting.
  protected regionFlag(model: Model): string {
    const country = (model.hostingCountry ?? '').toUpperCase();
    if (country === 'CH' || model.privacyTier === 'ch_only') {
      return '🇨🇭';
    }
    if (country === 'EU' || model.privacyTier === 'eu') {
      return '🇪🇺';
    }
    return '🌐';
  }

  protected isPinned(modelId: string): boolean {
    return this._preferences.isModelPinned(modelId);
  }

  protected onSelectModel(model: Model): void {
    if (!model.isEligible) {
      return;
    }
    this._modelService.selectModel(model.id);
    this.modelSelected.emit(model);
  }

  protected onTogglePin(event: Event, model: Model): void {
    event.preventDefault();
    event.stopPropagation();
    if (this.isPinned(model.id)) {
      this._preferences.unpinModel(model.id);
    } else {
      this._preferences.pinModel(model.id);
    }
  }

  // Keyboard navigation across visible rows (spec §4.4). Arrow/Home/End move
  // focus; Enter activates natively (rows are buttons); Escape asks to close.
  protected onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      this.closed.emit();
      return;
    }
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      return;
    }
    const rows = Array.from(
      this._host.nativeElement.querySelectorAll<HTMLButtonElement>(
        '.model-selector__row:not([disabled])',
      ),
    );
    if (rows.length === 0) {
      return;
    }
    event.preventDefault();
    const current = rows.indexOf(document.activeElement as HTMLButtonElement);
    let next: number;
    switch (event.key) {
      case 'ArrowDown':
        next = current < 0 ? 0 : Math.min(current + 1, rows.length - 1);
        break;
      case 'ArrowUp':
        next = current < 0 ? rows.length - 1 : Math.max(current - 1, 0);
        break;
      case 'Home':
        next = 0;
        break;
      default:
        next = rows.length - 1;
    }
    rows[next].focus();
  }
}
