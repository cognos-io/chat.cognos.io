import { CommonModule } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { DialogRef } from '@angular/cdk/dialog';

import { CognosButtonComponent, CognosDialogSurfaceComponent } from '@cognos/ui-angular';

import { TagComponent } from '@app/components/tag/tag.component';
import { Model } from '@app/interfaces/model';
import { ModelService } from '@app/services/model.service';
import { ProviderService } from '@app/services/provider.service';

@Component({
  selector: 'app-model-selector',
  standalone: true,
  imports: [
    CommonModule,
    CognosDialogSurfaceComponent,
    CognosButtonComponent,
    TagComponent,
  ],
  template: `
    <cog-dialog-surface title="Pick your AI model" [footer]="true" (close)="close()">
      <div class="model-selector">
        <div class="model-selector__copy">
          <p>
            You can choose from a variety of AI models to chat with. Each model has its
            own personality and capabilities.
          </p>
        </div>

        <div class="model-selector__groups">
          @for (providerId of providerIds(); track providerId) {
            <section class="model-selector__group">
              <header class="model-selector__group-header">
                <div>
                  <h3 class="model-selector__group-title">
                    {{ providerService.lookupProvider(providerId)()?.name }}
                  </h3>
                  <p class="model-selector__group-description">
                    {{ providerService.lookupProvider(providerId)()?.description }}
                  </p>
                </div>

                @if (providerService.lookupProvider(providerId)()?.isOpenSource) {
                  <app-tag
                    [tag]="{ title: 'open-source', color: { palette: 'primary' } }"
                  ></app-tag>
                }
              </header>

              <div class="model-selector__list" role="radiogroup">
                @for (model of modelService.groupedModels()[providerId]; track model.id) {
                  <label class="model-selector__card">
                    <input
                      class="model-selector__radio"
                      type="radio"
                      name="model"
                      [checked]="newModel.id === model.id"
                      (change)="newModel = model"
                    />

                    <div class="model-selector__content">
                      @if (model.id === selectedModel.id) {
                        <div class="model-selector__status">Currently active</div>
                      }
                      <div class="model-selector__title">{{ model.name }}</div>
                      <p class="model-selector__description">{{ model.description }}</p>
                      @if (model.tags && model.tags.length > 0) {
                        <div class="model-selector__tags">
                          @for (tag of model.tags; track tag) {
                            <app-tag [tag]="tag"></app-tag>
                          }
                        </div>
                      }
                    </div>
                  </label>
                }
              </div>
            </section>
          }
        </div>
      </div>

      <div cogDialogFooter>
        <cog-button appearance="subtle" (click)="close()">Cancel</cog-button>
        <cog-button
          appearance="primary"
          [disabled]="newModel.id === selectedModel.id"
          (click)="onSaveModelChange()"
        >
          Select
        </cog-button>
      </div>
    </cog-dialog-surface>
  `,
  styles: `
    .model-selector,
    .model-selector__copy,
    .model-selector__groups,
    .model-selector__group,
    .model-selector__content,
    .model-selector__list {
      display: grid;
      gap: var(--cog-space-150);
    }

    .model-selector__copy p,
    .model-selector__group-description,
    .model-selector__description {
      margin: 0;
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-body);
      line-height: var(--cog-lh-body);
    }

    .model-selector__group {
      border: 1px solid var(--cog-border);
      border-radius: var(--cog-radius-md);
      background: var(--cog-surface-raised);
      padding: var(--cog-space-150);
    }

    .model-selector__group-header {
      display: flex;
      align-items: flex-start;
      justify-content: space-between;
      gap: var(--cog-space-150);
    }

    .model-selector__group-title,
    .model-selector__title {
      margin: 0;
      color: var(--cog-text);
      font-size: var(--cog-fs-h-sm);
      font-weight: var(--cog-fw-h-sm);
      line-height: var(--cog-lh-h-sm);
    }

    .model-selector__card {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      gap: var(--cog-space-150);
      align-items: start;
      border: 1px solid var(--cog-border);
      border-radius: var(--cog-radius-sm);
      background: var(--cog-surface);
      padding: var(--cog-space-150);
      cursor: pointer;
    }

    .model-selector__radio {
      margin-top: 3px;
      accent-color: var(--cog-brand);
    }

    .model-selector__status {
      color: var(--cog-success-text);
      font-size: var(--cog-fs-caption);
      font-weight: var(--cog-fw-semibold);
      line-height: var(--cog-lh-caption);
      text-transform: uppercase;
      letter-spacing: var(--cog-ls-overline);
    }

    .model-selector__tags {
      display: flex;
      flex-wrap: wrap;
      gap: var(--cog-space-100);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ModelSelectorComponent {
  private readonly _dialogRef = inject(DialogRef<Model | undefined>);

  readonly modelService = inject(ModelService);
  readonly providerService = inject(ProviderService);

  newModel: Model = this.modelService.selectedModel();

  providerIds = computed(() => Object.keys(this.modelService.groupedModels()));

  get selectedModel() {
    return this.modelService.selectedModel();
  }

  close() {
    this._dialogRef.close(undefined);
  }

  onSaveModelChange() {
    this.modelService.selectModel(this.newModel.id);
    this._dialogRef.close(this.newModel);
  }
}
