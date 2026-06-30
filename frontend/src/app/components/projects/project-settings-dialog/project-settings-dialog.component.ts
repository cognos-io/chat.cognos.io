import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';

import { TranslocoModule } from '@jsverse/transloco';

import {
  CognosAvatarPickerComponent,
  CognosButtonComponent,
  CognosDialogSurfaceComponent,
} from '@cognos/ui-angular';

import { PersonaAvatarComponent } from '@app/components/personas/persona-avatar/persona-avatar.component';
import {
  ProjectColor,
  ProjectIcon,
  coerceProjectIcon,
  defaultProjectColor,
  defaultProjectIcon,
  projectColors,
  projectIcons,
} from '@app/interfaces/project';
import { ModelService } from '@app/services/model.service';
import { ProjectService } from '@app/services/project.service';

// Edits a project's display identity (name, icon, colour) and description. The
// icon/colour pickers mirror the persona editor so the two surfaces feel the
// same. Project instructions are edited inline on the project page, not here.
@Component({
  selector: 'app-project-settings-dialog',
  standalone: true,
  imports: [
    FormsModule,
    TranslocoModule,
    CognosAvatarPickerComponent,
    CognosButtonComponent,
    CognosDialogSurfaceComponent,
    PersonaAvatarComponent,
  ],
  template: `
    <cog-dialog-surface
      *transloco="let t"
      [title]="t('projects.settings.title')"
      [footer]="true"
      [width]="560"
      (close)="close()"
    >
      <div class="project-settings">
        <div class="project-settings__preview">
          <app-persona-avatar [icon]="icon()" [color]="color()" [size]="48" />
          <div class="project-settings__preview-text">
            <span class="project-settings__preview-name">{{
              name().trim() || t('projects.settings.untitled')
            }}</span>
            <span class="project-settings__preview-hint">{{
              t('projects.settings.previewHint')
            }}</span>
          </div>
        </div>

        <label class="project-settings__field">
          <span class="project-settings__label">{{ t('projects.nameLabel') }}</span>
          <input
            type="text"
            class="project-settings__input"
            [ngModel]="name()"
            (ngModelChange)="name.set($event)"
            [placeholder]="t('projects.namePlaceholder')"
            maxlength="80"
            autocomplete="off"
            data-testid="project-settings-name"
          />
        </label>

        <label class="project-settings__field">
          <span class="project-settings__label">{{
            t('projects.descriptionLabel')
          }}</span>
          <input
            type="text"
            class="project-settings__input"
            [ngModel]="description()"
            (ngModelChange)="description.set($event)"
            [placeholder]="t('projects.descriptionPlaceholder')"
            maxlength="160"
            autocomplete="off"
          />
        </label>

        <label class="project-settings__field">
          <span class="project-settings__label">{{
            t('projects.settings.defaultModelLabel')
          }}</span>
          <select
            class="project-settings__input"
            [ngModel]="defaultModelId()"
            (ngModelChange)="defaultModelId.set($event)"
            data-testid="project-settings-default-model"
          >
            <option value="">{{ t('projects.settings.defaultModelAuto') }}</option>
            @for (model of eligibleModels(); track model.id) {
              <option [value]="model.id">{{ model.name }}</option>
            }
          </select>
          <span class="project-settings__hint">{{
            t('projects.settings.defaultModelHint')
          }}</span>
        </label>

        <fieldset class="project-settings__field">
          <legend class="project-settings__label">
            {{ t('projects.settings.iconLegend') }}
          </legend>
          <cog-avatar-picker
            [icons]="icons"
            [colors]="colors"
            [selectedIcon]="icon()"
            [selectedColor]="color()"
            [name]="name()"
            [iconAriaLabel]="t('projects.settings.iconLegend')"
            [colorAriaLabel]="t('projects.settings.colourLegend')"
            (iconChange)="selectIcon($event)"
            (colorChange)="color.set($event)"
          />
        </fieldset>
      </div>

      <div cogDialogFooter>
        <cog-button appearance="subtle" (click)="close()">
          {{ t('common.cancel') }}
        </cog-button>
        <cog-button
          appearance="primary"
          icon="check"
          [disabled]="!canSave() || saving()"
          (click)="save()"
          data-testid="project-settings-save"
        >
          {{ saving() ? t('projects.saving') : t('projects.save') }}
        </cog-button>
      </div>
    </cog-dialog-surface>
  `,
  styles: `
    .project-settings {
      display: grid;
      gap: var(--cog-space-200);
    }

    .project-settings__preview {
      display: flex;
      align-items: center;
      gap: var(--cog-space-150);
      padding: var(--cog-space-150);
      border-radius: var(--cog-radius-md);
      background: var(--cog-surface-sunken);
    }

    .project-settings__preview-text {
      display: grid;
      gap: var(--cog-space-025);
      min-width: 0;
    }

    .project-settings__preview-name {
      color: var(--cog-text);
      font-weight: var(--cog-fw-semibold);
      font-size: var(--cog-fs-body-lg);
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .project-settings__preview-hint {
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-caption);
    }

    .project-settings__field {
      display: grid;
      gap: var(--cog-space-100);
      margin: 0;
      padding: 0;
      border: 0;
    }

    .project-settings__label {
      padding: 0;
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-caption);
      font-weight: var(--cog-fw-semibold);
    }

    .project-settings__hint {
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-caption);
    }

    .project-settings__input {
      min-height: 40px;
      border: 2px solid var(--cog-border);
      border-radius: var(--cog-radius-sm);
      background: var(--cog-input-bg);
      color: var(--cog-text);
      padding: 0 var(--cog-space-150);
      font: inherit;
      outline: 0;
    }

    .project-settings__input:focus {
      border-color: var(--cog-brand);
      background: var(--cog-input-bg-focus);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectSettingsDialogComponent {
  private readonly _dialogRef = inject(DialogRef<void>);
  private readonly _projects = inject(ProjectService);
  private readonly _models = inject(ModelService);
  private readonly _data: { projectId: string } = inject(DIALOG_DATA);

  protected readonly icons = projectIcons;
  protected readonly colors = projectColors;

  // Eligible models for the project-default picker. Ineligible (tier-locked)
  // models are excluded so a member can't pin a default they can't use.
  protected readonly eligibleModels = this._models.eligibleModels;

  private readonly _project = computed(() =>
    this._projects.projects().find((p) => p.record.id === this._data.projectId),
  );

  protected readonly name = signal('');
  protected readonly description = signal('');
  protected readonly icon = signal<ProjectIcon>(defaultProjectIcon);
  protected readonly color = signal<ProjectColor>(defaultProjectColor);

  protected selectIcon(icon: string): void {
    this.icon.set(coerceProjectIcon(icon));
  }
  // '' means "no project default" — fall back to the member's personal default.
  protected readonly defaultModelId = signal('');
  protected readonly saving = signal(false);

  protected readonly canSave = computed(() => this.name().trim() !== '');

  constructor() {
    const project = this._project();
    if (project) {
      this.name.set(project.decryptedData.name);
      this.description.set(project.decryptedData.description);
      this.icon.set(project.decryptedData.icon);
      this.color.set(project.decryptedData.color);
      this.defaultModelId.set(project.decryptedData.defaultModelId);
    }
  }

  protected close(): void {
    this._dialogRef.close();
  }

  protected save(): void {
    const project = this._project();
    if (!project || !this.canSave() || this.saving()) {
      return;
    }
    this.saving.set(true);
    this._projects
      .updateProject(this._data.projectId, {
        version: '1',
        name: this.name().trim(),
        description: this.description().trim(),
        icon: this.icon(),
        color: this.color(),
        // Preserve instructions, which are edited on the project page.
        instructions: project.decryptedData.instructions,
        defaultModelId: this.defaultModelId(),
      })
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.close();
        },
        error: () => this.saving.set(false),
      });
  }
}
