import { CommonModule } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  EventEmitter,
  Output,
  computed,
  inject,
} from '@angular/core';

import { CognosIconComponent } from '@cognos/ui-angular';

import { TagComponent } from '@app/components/tag/tag.component';
import { Model } from '@app/interfaces/model';
import { ModelService } from '@app/services/model.service';
import { UserPreferencesService } from '@app/services/user-preferences.service';

@Component({
  selector: 'app-model-selector',
  standalone: true,
  imports: [CommonModule, CognosIconComponent, TagComponent],
  template: `
    <div class="model-selector" role="listbox" aria-label="Pick your AI model">
      <ul class="model-selector__list">
        @for (model of orderedModels(); track model.id) {
          <li>
            <button
              type="button"
              role="option"
              class="model-selector__row"
              [class.model-selector__row--active]="model.id === selectedModelId()"
              [attr.aria-selected]="model.id === selectedModelId()"
              (click)="onSelectModel(model)"
            >
              <span
                class="model-selector__pin"
                [class.model-selector__pin--pinned]="isPinned(model.id)"
              >
                <button
                  type="button"
                  class="model-selector__pin-button"
                  [attr.title]="isPinned(model.id) ? 'Unpin model' : 'Pin model'"
                  [attr.aria-pressed]="isPinned(model.id)"
                  (click)="onTogglePin($event, model)"
                >
                  <cog-icon name="pin" [size]="14" tone="current" />
                </button>
              </span>

              <span class="model-selector__body">
                <span class="model-selector__heading">
                  <span class="model-selector__name">{{ model.name }}</span>
                  @if (model.tags && model.tags.length > 0) {
                    <span class="model-selector__tags">
                      @for (tag of model.tags; track tag.title) {
                        <app-tag [tag]="tag"></app-tag>
                      }
                    </span>
                  }
                </span>
                <span class="model-selector__description">
                  {{ model.description }}
                </span>
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
          </li>
        }
      </ul>
    </div>
  `,
  styles: `
    :host {
      display: block;
    }

    .model-selector {
      width: min(420px, calc(100vw - var(--cog-space-200)));
      max-height: min(420px, calc(100vh - 160px));
      overflow-y: auto;
      border: 1px solid var(--cog-border);
      border-radius: var(--cog-radius-md);
      background: var(--cog-surface-raised);
      box-shadow: var(--cog-shadow-overlay, 0 10px 30px rgba(0, 0, 0, 0.12));
      padding: var(--cog-space-075);
    }

    .model-selector__list {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: var(--cog-space-025, 2px);
    }

    .model-selector__row {
      display: grid;
      grid-template-columns: 24px minmax(0, 1fr) auto;
      align-items: start;
      gap: var(--cog-space-100);
      width: 100%;
      border: 0;
      background: transparent;
      border-radius: var(--cog-radius-sm);
      padding: var(--cog-space-100);
      text-align: left;
      cursor: pointer;
      color: var(--cog-text);
      font: inherit;
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

    .model-selector__row--active:hover,
    .model-selector__row--active:focus-visible {
      background: var(--cog-selected-bg, rgba(46, 160, 67, 0.16));
    }

    .model-selector__pin {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      margin-top: 1px;
      opacity: 0;
      transition: opacity var(--cog-dur-fast) var(--cog-ease-standard);
    }

    .model-selector__row:hover .model-selector__pin,
    .model-selector__row:focus-within .model-selector__pin,
    .model-selector__pin--pinned {
      opacity: 1;
    }

    .model-selector__pin-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 100%;
      border: 0;
      border-radius: var(--cog-radius-xs);
      background: transparent;
      color: var(--cog-text-subtlest);
      cursor: pointer;
      padding: 0;
      transition: color var(--cog-dur-fast) var(--cog-ease-standard);
    }

    .model-selector__pin-button:hover {
      color: var(--cog-text);
    }

    .model-selector__pin--pinned .model-selector__pin-button {
      color: var(--cog-brand);
    }

    .model-selector__body {
      display: grid;
      gap: var(--cog-space-025, 2px);
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
      color: var(--cog-text);
    }

    .model-selector__tags {
      display: inline-flex;
      flex-wrap: wrap;
      gap: var(--cog-space-050, 4px);
    }

    .model-selector__description {
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-caption);
      line-height: var(--cog-lh-caption);
      overflow: hidden;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }

    .model-selector__check {
      margin-top: 2px;
      align-self: center;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ModelSelectorComponent {
  private readonly _modelService = inject(ModelService);
  private readonly _preferencesService = inject(UserPreferencesService);

  @Output() readonly modelSelected = new EventEmitter<Model>();

  // Snapshot of pinned model IDs captured when the dropdown opens.
  // Why: keeps row order stable while the dropdown is visible — newly
  // pinned models stay in place and only float to the top on next open.
  private readonly _frozenPinnedIds: ReadonlySet<string> = new Set(
    this._preferencesService.pinnedModels(),
  );

  readonly selectedModelId = computed(() => this._modelService.selectedModel().id);

  readonly orderedModels = computed<Model[]>(() => {
    const all = this._modelService.modelList();
    const frozen = this._frozenPinnedIds;
    if (frozen.size === 0) {
      return all;
    }
    const pinned: Model[] = [];
    const rest: Model[] = [];
    for (const model of all) {
      (frozen.has(model.id) ? pinned : rest).push(model);
    }
    return [...pinned, ...rest];
  });

  isPinned(modelId: string): boolean {
    return this._preferencesService.isModelPinned(modelId);
  }

  onSelectModel(model: Model) {
    this._modelService.selectModel(model.id);
    this.modelSelected.emit(model);
  }

  onTogglePin(event: Event, model: Model) {
    event.preventDefault();
    event.stopPropagation();
    if (this.isPinned(model.id)) {
      this._preferencesService.unpinModel(model.id);
    } else {
      this._preferencesService.pinModel(model.id);
    }
  }
}
