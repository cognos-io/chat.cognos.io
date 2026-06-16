import { DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { FormsModule } from '@angular/forms';

import {
  CognosButtonComponent,
  CognosDialogSurfaceComponent,
} from '@cognos/ui-angular';

import { TagComponent } from '@app/components/tag/tag.component';
import {
  Persona,
  defaultPersonaColor,
  defaultPersonaIcon,
} from '@app/interfaces/persona';
import { PersonaService } from '@app/services/persona.service';

@Component({
  selector: 'app-persona-selector',
  standalone: true,
  imports: [
    FormsModule,
    CognosDialogSurfaceComponent,
    CognosButtonComponent,
    TagComponent,
  ],
  template: `
    <cog-dialog-surface title="Choose a persona" [footer]="true" (close)="close()">
      <div class="persona-selector">
        <div class="persona-selector__copy">
          <p>
            Personas are reusable instructions for how Cognos should respond. You can
            switch persona at any time; the selected prompt is sent only for the next
            completion.
          </p>
          <p>Custom personas are encrypted in your browser before they are saved.</p>
        </div>

        <div class="persona-selector__list" role="radiogroup">
          @for (persona of personaService.personaList(); track persona.id) {
            <label class="persona-selector__card">
              <input
                class="persona-selector__radio"
                type="radio"
                name="persona"
                [checked]="newPersona.id === persona.id"
                [disabled]="persona.id === selectedPersona.id"
                (change)="newPersona = persona"
              />

              <div class="persona-selector__content">
                @if (persona.id === selectedPersona.id) {
                  <div class="persona-selector__status">Currently active</div>
                }
                <div class="persona-selector__title">{{ persona.name }}</div>
                <p class="persona-selector__description">{{ persona.description }}</p>
                @if (persona.tags && persona.tags.length > 0) {
                  <div class="persona-selector__tags">
                    @for (tag of persona.tags; track tag) {
                      <app-tag [tag]="tag"></app-tag>
                    }
                  </div>
                }
              </div>
            </label>
          }
        </div>

        <form class="persona-selector__form" (ngSubmit)="createPersona()">
          <h3 class="persona-selector__form-title">Create your own</h3>
          <label>
            Name
            <input name="name" [(ngModel)]="customName" required />
          </label>
          <label>
            Description
            <input name="description" [(ngModel)]="customDescription" required />
          </label>
          <label>
            Instructions
            <textarea
              name="systemPrompt"
              rows="5"
              [(ngModel)]="customSystemPrompt"
              required
            ></textarea>
          </label>
          <cog-button
            appearance="subtle"
            type="submit"
            [disabled]="!canCreatePersona() || creatingPersona"
          >
            Save encrypted persona
          </cog-button>
        </form>
      </div>

      <div cogDialogFooter>
        <cog-button appearance="subtle" (click)="close()">Cancel</cog-button>
        <cog-button
          appearance="primary"
          [disabled]="newPersona.id === selectedPersona.id"
          (click)="onSavePersonaChange()"
        >
          Select
        </cog-button>
      </div>
    </cog-dialog-surface>
  `,
  styles: `
    .persona-selector,
    .persona-selector__copy,
    .persona-selector__list,
    .persona-selector__content,
    .persona-selector__form {
      display: grid;
      gap: var(--cog-space-150);
    }

    .persona-selector {
      max-height: min(65vh, 640px);
      overflow-y: auto;
    }

    .persona-selector__copy p,
    .persona-selector__description {
      margin: 0;
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-body);
      line-height: var(--cog-lh-body);
    }

    .persona-selector__card {
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

    .persona-selector__radio {
      margin-top: 3px;
      accent-color: var(--cog-brand);
    }

    .persona-selector__status {
      color: var(--cog-success-text);
      font-size: var(--cog-fs-caption);
      font-weight: var(--cog-fw-semibold);
      line-height: var(--cog-lh-caption);
      text-transform: uppercase;
      letter-spacing: var(--cog-ls-overline);
    }

    .persona-selector__title,
    .persona-selector__form-title {
      margin: 0;
      color: var(--cog-text);
      font-size: var(--cog-fs-h-sm);
      font-weight: var(--cog-fw-h-sm);
      line-height: var(--cog-lh-h-sm);
    }

    .persona-selector__tags {
      display: flex;
      flex-wrap: wrap;
      gap: var(--cog-space-100);
    }

    .persona-selector__form {
      border-top: 1px solid var(--cog-border);
      padding-top: var(--cog-space-150);
    }

    .persona-selector__form label {
      display: grid;
      gap: var(--cog-space-75);
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-caption);
      line-height: var(--cog-lh-caption);
    }

    .persona-selector__form input,
    .persona-selector__form textarea {
      border: 1px solid var(--cog-border);
      border-radius: var(--cog-radius-sm);
      background: var(--cog-surface);
      color: var(--cog-text);
      padding: var(--cog-space-100);
      font: inherit;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PersonaSelectorComponent {
  private readonly _dialogRef = inject(DialogRef<Persona | undefined>);

  public readonly personaService = inject(PersonaService);

  newPersona: Persona = this.personaService.selectedPersona();
  customName = '';
  customDescription = '';
  customSystemPrompt = '';
  creatingPersona = false;

  get selectedPersona() {
    return this.personaService.selectedPersona();
  }

  close() {
    this._dialogRef.close(undefined);
  }

  onSavePersonaChange() {
    this.personaService.selectPersona(this.newPersona.id);
    this._dialogRef.close(this.newPersona);
  }

  canCreatePersona() {
    return (
      this.customName.trim() !== '' &&
      this.customDescription.trim() !== '' &&
      this.customSystemPrompt.trim() !== ''
    );
  }

  createPersona() {
    if (!this.canCreatePersona()) {
      return;
    }

    this.creatingPersona = true;
    this.personaService
      .createPersona({
        name: this.customName,
        description: this.customDescription,
        systemPrompt: this.customSystemPrompt,
        icon: defaultPersonaIcon,
        color: defaultPersonaColor,
      })
      .subscribe({
        next: (persona) => {
          this.newPersona = persona;
          this.customName = '';
          this.customDescription = '';
          this.customSystemPrompt = '';
          this.creatingPersona = false;
        },
        error: () => {
          this.creatingPersona = false;
        },
      });
  }
}
