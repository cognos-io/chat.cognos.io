import { CommonModule } from '@angular/common';
import { Component, computed, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule } from '@angular/material/dialog';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatRadioModule } from '@angular/material/radio';

import { TagComponent } from '@app/components/tag/tag.component';
import { Model } from '@app/interfaces/model';
import { ModelService } from '@app/services/model.service';
import { ProviderService } from '@app/services/provider.service';

@Component({
  selector: 'app-model-selector',
  standalone: true,
  imports: [
    CommonModule,
    MatDialogModule,
    MatExpansionModule,
    MatButtonModule,
    MatRadioModule,
    FormsModule,
    TagComponent,
  ],
  template: ` <h2 mat-dialog-title>Pick your AI model</h2>
    <mat-dialog-content>
      <p class="my-2">
        You can choose from a variety of AI models to chat with. Each model has its own
        unique personality and capabilities.
      </p>
      <h4 class="my-4 text-lg font-semibold">Available models:</h4>

      <mat-accordion>
        @for (providerId of providerIds(); track providerId) {
          <mat-expansion-panel
            class="provider-panel"
            [expanded]="providerId === selectedModel.providerId"
            [ngClass]="{ active: providerId === selectedModel.providerId }"
          >
            <mat-expansion-panel-header>
              <mat-panel-title>
                {{ providerService.lookupProvider(providerId)()?.name }}
              </mat-panel-title>
              @if (providerService.lookupProvider(providerId)()?.isOpenSource) {
                <mat-panel-description>
                  <app-tag
                    [tag]="{ title: 'open-source', color: { palette: 'primary' } }"
                  ></app-tag>
                </mat-panel-description>
              }
            </mat-expansion-panel-header>
            <p>
              {{ providerService.lookupProvider(providerId)()?.description }}
            </p>
            <ul role="list" class="divide-y divide-gray-100">
              <mat-radio-group required="true" [(ngModel)]="newModel">
                @for (
                  model of modelService.groupedModels()[providerId];
                  track model.id
                ) {
                  <li class="flex items-center justify-between gap-x-6 py-5">
                    <mat-radio-button [value]="model" class="flex flex-grow gap-x-4">
                      <div class="min-w-0 flex-auto">
                        @if (model.id === selectedModel.id) {
                          <span
                            class="inline-flex items-center rounded-md bg-green-50 px-2 py-1 text-xs font-medium text-green-700 ring-1 ring-inset ring-green-600/20"
                            >Currently active</span
                          >
                        }
                        <p class="text-sm font-semibold leading-6 text-gray-900">
                          {{ model.name }}
                        </p>
                        <p class="my-2 text-gray-700">{{ model.description }}</p>
                        @if (model.tags && model.tags.length > 0) {
                          <div class="mt-2 flex gap-x-2">
                            @for (tag of model.tags; track tag) {
                              <app-tag [tag]="tag"></app-tag>
                            }
                          </div>
                        }
                      </div>
                    </mat-radio-button>
                  </li>
                }
              </mat-radio-group>
            </ul>
          </mat-expansion-panel>
        }
      </mat-accordion>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>Cancel</button>
      <button
        mat-button
        color="primary"
        [mat-dialog-close]="selectedModel"
        [disabled]="newModel === selectedModel"
        (click)="onSaveModelChange()"
      >
        Select
      </button>
    </mat-dialog-actions>`,
  styles: `
    mat-expansion-panel.provider-panel {
      @apply shadow-none;

      &.active {
        @apply border border-green-600/50 shadow shadow-green-900/20 ring-green-600/20;
      }
    }
  `,
})
export class ModelSelectorComponent {
  readonly modelService = inject(ModelService);
  readonly providerService = inject(ProviderService);

  newModel: Model = this.modelService.selectedModel();

  providerIds = computed(() => Object.keys(this.modelService.groupedModels()));

  get selectedModel() {
    return this.modelService.selectedModel();
  }

  onSaveModelChange() {
    this.modelService.selectModel(this.newModel.id);
  }
}
