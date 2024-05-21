import { Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule } from '@angular/material/dialog';
import { MatRadioModule } from '@angular/material/radio';

import { Model } from '@app/interfaces/model';
import { ModelService } from '@app/services/model.service';

@Component({
  selector: 'app-model-selector',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatRadioModule, FormsModule],
  template: ` <h2 mat-dialog-title>Pick your AI model</h2>
    <mat-dialog-content>
      <p class="my-2">
        You can choose from a variety of AI models to chat with. Each model has its own
        unique personality and capabilities.
      </p>
      <h4 class="my-4 text-lg font-semibold">Available models:</h4>

      <ul role="list" class="divide-y divide-gray-100">
        <mat-radio-group required="true" [(ngModel)]="newModel">
          @for (model of modelService.modelList(); track model.id) {
            <li class="flex items-center justify-between gap-x-6 py-5">
              <mat-radio-button [value]="model" class="flex flex-grow gap-x-4">
                <div class="min-w-0 flex-auto">
                  <p class="text-sm font-semibold leading-6 text-gray-900">
                    {{ model.name }}
                    @if (model.id === selectedModel.id) {
                      <span
                        class="mx-2 inline-flex items-center rounded-md bg-green-50 px-2 py-1 text-xs font-medium text-green-700 ring-1 ring-inset ring-green-600/20"
                        >Currently active</span
                      >
                    }
                  </p>
                  <p class="text-gray-700">{{ model.description }}</p>
                  <p class="mt-1 flex text-xs leading-5 text-gray-500"></p>
                </div>
              </mat-radio-button>
            </li>
          }
        </mat-radio-group>
      </ul>
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
  styles: ``,
})
export class ModelSelectorComponent {
  readonly modelService = inject(ModelService);

  newModel: Model = this.modelService.selectedModel();

  get selectedModel() {
    return this.modelService.selectedModel();
  }

  onSaveModelChange() {
    this.modelService.selectModel(this.newModel.id);
  }
}
