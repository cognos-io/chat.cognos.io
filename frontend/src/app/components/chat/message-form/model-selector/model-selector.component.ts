import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  EventEmitter,
  OnInit,
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

import {
  CognosIconComponent,
  CognosLozengeComponent,
  CognosSegmentedControlComponent,
  CognosSegmentedOption,
} from '@cognos/ui-angular';

import { localizedModelIneligibility } from '@app/i18n/model-ineligibility';
import { Model } from '@app/interfaces/model';
import { BillingService } from '@app/services/billing.service';
import { ModelService } from '@app/services/model.service';
import { ProjectService } from '@app/services/project.service';
import { UserPreferencesService } from '@app/services/user-preferences.service';
import { modelCapabilityMetadata } from '@app/utils/model-capability-metadata';
import { ModelCostTier, deriveModelCostTier } from '@app/utils/model-cost-tier';
import {
  MODEL_FILTER_CHIPS,
  ModelFilterChip,
  QuickFilter,
  RequiredCapability,
  SearchContext,
  SortMode,
  buildSearchSynonyms,
  formatContextWindow,
  matchesQuickFilter,
  modelStrengthPills,
  modelSupportsCapability,
  orderModels,
} from '@app/utils/model-discovery';
import { regionFlag } from '@app/utils/region';

// The segmented sort control's buttons. 'cost' is one segment that toggles
// between ascending and descending on repeated taps; the other keys map 1:1 to
// a SortMode.
type SortSegmentKey = 'recommended' | 'newest' | 'cost' | 'recent';

interface SortSegment {
  key: SortSegmentKey;
  labelKey: string;
}

const SORT_SEGMENTS: readonly SortSegment[] = [
  { key: 'recommended', labelKey: 'chat.models.sort.recommended' },
  { key: 'newest', labelKey: 'chat.models.sort.newest' },
  { key: 'cost', labelKey: 'chat.models.sort.cost' },
  { key: 'recent', labelKey: 'chat.models.sort.recent' },
];

// How the selector is presented. The same content renders as a compact dropdown
// on desktop and a bottom-sheet on mobile (spec §4.5); only the chrome differs.
export type ModelSelectorLayout = 'dropdown' | 'sheet';

@Component({
  selector: 'app-model-selector',
  standalone: true,
  imports: [
    CommonModule,
    CognosIconComponent,
    CognosLozengeComponent,
    CognosSegmentedControlComponent,
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

      @if (projectDefaultUnavailable()) {
        <p class="model-selector__notice" role="status">
          <cog-icon name="info" [size]="14" tone="text-subtle" />
          {{ t('chat.models.projectDefaultUnavailable') }}
        </p>
      }

      <!-- Scrollable, flat model list (top), ordered by the chosen sort. -->
      <div
        class="model-selector__list"
        role="listbox"
        [attr.aria-label]="t('chat.models.pickAria')"
      >
        @for (model of models(); track model.id) {
          <div class="model-selector__row-wrap">
            <button
              type="button"
              role="option"
              class="model-selector__row"
              [class.model-selector__row--active]="model.id === selectedModelId()"
              [class.model-selector__row--disabled]="!model.isEligible"
              [attr.aria-selected]="model.id === selectedModelId()"
              [attr.aria-describedby]="
                !model.isEligible ? ineligibilityId(model) : null
              "
              [attr.title]="!model.isEligible ? ineligibilityReason(model, t) : null"
              [disabled]="!model.isEligible"
              (click)="onSelectModel(model)"
            >
              <span class="model-selector__body">
                <span class="model-selector__heading">
                  <span class="model-selector__name">{{ model.displayName }}</span>
                  @if (!model.isEligible) {
                    <cog-lozenge tone="red">
                      {{ t('chat.models.unavailable.badge') }}
                    </cog-lozenge>
                  }
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

                @if (!model.isEligible) {
                  <span class="model-selector__reason" [id]="ineligibilityId(model)">
                    <cog-icon name="lock" [size]="12" tone="current" />
                    {{ ineligibilityReason(model, t) }}
                  </span>
                }
              </span>

              <span class="model-selector__check-slot">
                @if (model.id === selectedModelId()) {
                  <cog-icon
                    class="model-selector__check"
                    name="check"
                    [size]="16"
                    tone="success"
                  />
                }
              </span>
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

        @if (isEmpty()) {
          <div class="model-selector__empty">
            <p>{{ t(emptyMessageKey()) }}</p>
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

        <cog-segmented-control
          [options]="sortOptions()"
          [value]="activeSortSegment()"
          [ariaLabel]="t('chat.models.sort.label')"
          (select)="onSortSegment($event)"
        />

        <div
          class="model-selector__chips"
          role="group"
          [attr.aria-label]="t('chat.models.pickAria')"
        >
          @for (chip of availableFilterChips(); track chip.key) {
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
      border: var(--cog-border-width) solid var(--cog-border);
      border-radius: var(--cog-radius-md);
      background: var(--cog-surface-raised);
      box-shadow: var(--cog-shadow-overlay);
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
      border-radius: var(--cog-radius-pill);
      background: var(--cog-border);
    }

    .model-selector__sheet-title {
      margin: 0;
      font-size: var(--cog-fs-h-md);
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

    .model-selector__notice {
      display: flex;
      align-items: center;
      gap: var(--cog-space-075);
      margin: 0;
      padding: var(--cog-space-100);
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-caption);
      line-height: var(--cog-lh-caption);
      border-bottom: var(--cog-border-width) solid var(--cog-border);
    }

    .model-selector__list {
      flex: 1 1 auto;
      overflow-y: auto;
      padding: var(--cog-space-075);
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
      padding-right: var(--cog-space-500);
      text-align: left;
      cursor: pointer;
      color: var(--cog-text);
      font: inherit;
      min-height: 44px;
      transition: background-color var(--cog-dur-fast) var(--cog-ease-standard);
    }

    .model-selector__row:hover,
    .model-selector__row:focus-visible {
      background: var(--cog-surface-hover);
      outline: 0;
    }

    .model-selector__row--active {
      background: var(--cog-selected-bg);
    }

    .model-selector__row--disabled {
      cursor: not-allowed;
      opacity: 0.72;
    }

    .model-selector__body {
      display: grid;
      gap: var(--cog-space-050);
      min-width: 0;
    }

    .model-selector__heading {
      display: flex;
      flex-wrap: nowrap;
      align-items: center;
      gap: var(--cog-space-075);
      min-width: 0;
    }

    .model-selector__name {
      font-size: var(--cog-fs-body);
      font-weight: var(--cog-fw-semibold);
      line-height: var(--cog-lh-body);
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    /* Push the cost lozenge to the right edge of the row (col 1 has a uniform
       width thanks to the fixed check slot) so tiers line up vertically across
       models and are easy to compare. */
    .model-selector__cost {
      margin-left: auto;
      flex: none;
    }

    .model-selector__pills {
      display: inline-flex;
      flex-wrap: wrap;
      gap: var(--cog-space-050);
    }

    .model-selector__pill {
      padding: 1px var(--cog-space-075);
      border-radius: var(--cog-radius-xs);
      background: var(--cog-surface-sunken);
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
      display: inline-flex;
      align-items: center;
      gap: var(--cog-space-050);
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-caption);
      line-height: var(--cog-lh-caption);
    }

    /* Always reserved (even when the row isn't selected) so col 1 keeps the same
       width across rows and the cost lozenges align. Sized to the check icon. */
    .model-selector__check-slot {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: var(--cog-space-200);
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
      border-top: var(--cog-border-width) solid var(--cog-border);
      background: var(--cog-surface-raised);
    }

    .model-selector__search {
      display: flex;
      align-items: center;
      gap: var(--cog-space-075);
      padding: 0 var(--cog-space-100);
      border: var(--cog-border-width) solid var(--cog-border);
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
      gap: var(--cog-space-050);
      margin: 0;
      color: var(--cog-text-subtlest);
      font-size: var(--cog-fs-caption);
    }

    .model-selector__chips {
      display: flex;
      gap: var(--cog-space-075);
      overflow-x: auto;
      scrollbar-width: none;
      padding-bottom: var(--cog-space-025);
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
      border: var(--cog-border-width) solid var(--cog-border);
      border-radius: var(--cog-radius-pill);
      background: var(--cog-surface);
      color: var(--cog-text-subtle);
      font: inherit;
      font-size: var(--cog-fs-caption);
      cursor: pointer;
      white-space: nowrap;
    }

    .model-selector__chip--active {
      border-color: var(--cog-brand);
      background: var(--cog-selected-bg);
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
export class ModelSelectorComponent implements OnInit {
  private readonly _modelService = inject(ModelService);
  private readonly _preferences = inject(UserPreferencesService);
  private readonly _billing = inject(BillingService);
  private readonly _projects = inject(ProjectService);
  private readonly _transloco = inject(TranslocoService);
  private readonly _host = inject<ElementRef<HTMLElement>>(ElementRef);

  // Layout chrome differs (sheet header vs bare dropdown) but content is shared.
  readonly layout = input<ModelSelectorLayout>('dropdown');

  // Restrict the list to models that can do the current task: `text_completion`
  // in plain chat, `image_generation` when the image tool is on. `null` (account
  // settings) shows every model. See docs/specs/tool-aware-model-selection.md.
  readonly requiredCapability = input<RequiredCapability>(null);

  // A one-shot filter the composer asks us to pre-select for *this* open only —
  // e.g. 'vision' after the user tried to attach an image to a non-vision model.
  // Applied in ngOnInit without persisting, so the remembered filter returns on
  // the next open.
  readonly filterOverride = input<QuickFilter | null>(null);

  @Output() readonly modelSelected = new EventEmitter<Model>();
  // Asked to close (sheet X / Escape / settings link). The host owns open state.
  @Output() readonly closed = new EventEmitter<void>();

  // Frozen on open so rows don't jump while interacting (spec §7). The selector
  // is created fresh each time it opens, so these snapshots are per-open.
  private readonly _pinned: readonly string[] = [...this._preferences.pinnedModels()];
  private readonly _recent: readonly string[] = [...this._preferences.recentModels()];
  private readonly _hidden = new Set(this._preferences.hiddenModels());

  protected readonly searchQuery = signal('');
  protected readonly activeFilter = signal<QuickFilter | null>(
    this._preferences.modelQuickFilter(),
  );
  protected readonly sortMode = signal<SortMode>(this._preferences.modelSortMode());
  protected readonly sortSegments = SORT_SEGMENTS;
  protected readonly showHidden = signal(false);

  // Localised synonym map, built once from the active language's i18n catalogue.
  private readonly _synonyms = buildSearchSynonyms(
    this._transloco.translateObject('chat.models.synonyms') ?? {},
  );

  readonly selectedModelId = computed(() => this._modelService.selectedModel().id);

  protected readonly hideCost = computed(() => this._billing.isUnlimited());

  // True when the active project sets a default model that isn't usable for this
  // user (ineligible for their tier, or no longer in the catalogue). Resolution
  // silently falls through; this surfaces a localised explanation (spec §5.7).
  protected readonly projectDefaultUnavailable = computed(() => {
    const id = this._projects.selectedProject()?.decryptedData.defaultModelId;
    if (!id) {
      return false;
    }
    const model = this._modelService.modelList().find((m) => m.id === id);
    return !model || !model.isEligible;
  });

  protected readonly availableFilterChips = computed<ModelFilterChip[]>(() =>
    MODEL_FILTER_CHIPS.filter((chip) =>
      this._modelService
        .modelList()
        .some(
          (model) =>
            model.isEligible &&
            modelSupportsCapability(model, this.requiredCapability()) &&
            !this._hidden.has(model.id) &&
            matchesQuickFilter(
              model,
              chip.key,
              modelCapabilityMetadata,
              this._modelService.privacyTier(),
              this._pinned,
            ),
        ),
    ),
  );

  // Search index context, shared by models() and hasHiddenMatches() so a hidden
  // model that matches only on its localised cost-tier/region label is found by
  // both (otherwise "show hidden matches" wouldn't surface it).
  private searchContext(): SearchContext {
    return {
      costTierLabel: (model) =>
        this._transloco.translate('chat.models.costTier.' + this.costTier(model)),
      synonyms: this._synonyms,
      extraTerms: (model) => [
        this._transloco.translate(
          'account.dataProcessing.regionBadge.' + model.privacyTier,
        ),
      ],
    };
  }

  // The flat, ordered list of models rendered in the list. Pinned models are not
  // hoisted — the "Pinned" filter chip surfaces them instead.
  protected readonly models = computed(() =>
    orderModels({
      models: this._modelService.modelList(),
      pinnedIds: this._pinned,
      recentIds: this._recent,
      hiddenIds: [...this._hidden],
      privacyTier: this._modelService.privacyTier(),
      requiredCapability: this.requiredCapability(),
      quickFilter: this.activeFilter(),
      query: this.searchQuery(),
      showHidden: this.showHidden(),
      sort: this.sortMode(),
      searchContext: this.searchContext(),
    }),
  );

  // Options for the sort segmented control. The active segment carries a
  // direction chevron on Cost (flipped when ascending); computed so it updates
  // as the sort changes.
  protected readonly sortOptions = computed<CognosSegmentedOption[]>(() => {
    const active = this.activeSortSegment();
    const costActive = active === 'cost';
    return this.sortSegments.map((segment) => ({
      value: segment.key,
      label: this._transloco.translate(segment.labelKey),
      icon: segment.key === 'cost' && costActive ? 'chevron-down' : undefined,
      iconRotated: segment.key === 'cost' && this.costAscending(),
      iconLabel:
        segment.key === 'cost' && costActive
          ? this._transloco.translate(
              this.costAscending()
                ? 'chat.models.sort.costAsc'
                : 'chat.models.sort.costDesc',
            )
          : undefined,
    }));
  });

  protected readonly isEmpty = computed(() => this.models().length === 0);

  // Are there hidden models that match the current query (so we can offer
  // "show hidden matches")? Only meaningful when results are otherwise empty.
  protected readonly hasHiddenMatches = computed(() => {
    if (this._hidden.size === 0) {
      return false;
    }
    return (
      orderModels({
        models: this._modelService.modelList(),
        pinnedIds: this._pinned,
        recentIds: this._recent,
        hiddenIds: [...this._hidden],
        privacyTier: this._modelService.privacyTier(),
        requiredCapability: this.requiredCapability(),
        quickFilter: this.activeFilter(),
        query: this.searchQuery(),
        showHidden: true,
        searchContext: this.searchContext(),
      }).length > 0
    );
  });

  constructor() {
    // Drop a remembered chip when the current tier/capability/hidden set has no
    // usable matches, so opening the picker never starts in an empty category.
    effect(() => {
      const active = this.activeFilter();
      const loaded = this._modelService.modelList().length > 0;
      if (
        loaded &&
        active !== null &&
        !this.availableFilterChips().some((chip) => chip.key === active)
      ) {
        this.setActiveFilter(null);
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

  ngOnInit(): void {
    // Apply the composer's one-shot suggestion for this open only. We set the
    // signal directly (not setActiveFilter) so it isn't persisted — the user's
    // remembered filter is untouched and returns next time. The empty-category
    // effect above still clears it if no model matches.
    const override = this.filterOverride();
    if (override) {
      this.activeFilter.set(override);
    }
  }

  // When the image tool is active and nothing matches, explain that no model can
  // generate images rather than the generic "clear your search" copy — unless
  // the user is actually searching, where the generic message is accurate.
  protected emptyMessageKey(): string {
    return this.requiredCapability() === 'image_generation' &&
      !this.searchQuery().trim()
      ? 'chat.models.noImageModels'
      : 'chat.models.search.noResults';
  }

  protected onSearch(event: Event): void {
    const value = (event.target as HTMLInputElement).value;
    this.searchQuery.set(value);
    // Typing overrides the default Recommended chip so a name search isn't
    // narrowed to recommendations (spec §5.3). An explicitly chosen chip stays.
    if (value && this.activeFilter() === 'recommended') {
      this.setActiveFilter(null);
    }
  }

  protected toggleFilter(filter: QuickFilter): void {
    this.setActiveFilter(this.activeFilter() === filter ? null : filter);
  }

  private setActiveFilter(filter: QuickFilter | null): void {
    this.activeFilter.set(filter);
    this._preferences.setModelQuickFilter(filter);
  }

  // The segment currently highlighted. Both cost directions map to 'cost'.
  protected activeSortSegment(): SortSegmentKey {
    const mode = this.sortMode();
    return mode === 'cost_asc' || mode === 'cost_desc' ? 'cost' : mode;
  }

  // Tapping a segment sets its sort. The 'cost' segment is bidirectional: the
  // first tap sorts cheapest-first, tapping it again flips to dearest-first.
  // `key` arrives as a string from the segmented control; it is always one of
  // our own option values (a SortSegmentKey).
  protected onSortSegment(key: string): void {
    if (key === 'cost') {
      this.setSortMode(this.sortMode() === 'cost_asc' ? 'cost_desc' : 'cost_asc');
      return;
    }
    // The non-cost segment keys are exactly the matching SortMode values.
    this.setSortMode(key as SortMode);
  }

  // True when Cost sorts cheapest-first, so the chevron flips to point up.
  protected costAscending(): boolean {
    return this.sortMode() === 'cost_asc';
  }

  private setSortMode(mode: SortMode): void {
    this.sortMode.set(mode);
    this._preferences.setModelSortMode(mode);
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
  // space. Delegates to the shared helper so the selector, the per-answer
  // privacy receipt and the privacy panel all resolve the region identically.
  protected regionFlag(model: Model): string {
    return regionFlag(model);
  }

  protected ineligibilityId(model: Model): string {
    return 'model-selector-ineligible-' + model.id;
  }

  protected ineligibilityReason(
    model: Model,
    t: (key: string, params?: Record<string, string>) => string,
  ): string {
    return localizedModelIneligibility(model, this._modelService.privacyTier(), t);
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

    // When focus is in the search box, leave text editing (cursor/Home/End)
    // alone — except ArrowDown, which steps into the list so a user can type
    // then arrow into the results.
    const inSearch =
      event.target instanceof HTMLElement &&
      event.target.classList.contains('model-selector__search-input');
    if (inSearch && event.key !== 'ArrowDown') {
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
    if (inSearch) {
      rows[0].focus();
      return;
    }
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
