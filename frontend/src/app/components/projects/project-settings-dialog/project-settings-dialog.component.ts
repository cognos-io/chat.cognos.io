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
  CognosButtonComponent,
  CognosDialogSurfaceComponent,
} from '@cognos/ui-angular';

import { PersonaAvatarComponent } from '@app/components/personas/persona-avatar/persona-avatar.component';
import {
  ProjectColor,
  ProjectIcon,
  defaultProjectColor,
  defaultProjectIcon,
  projectColors,
  projectIcons,
} from '@app/interfaces/project';
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

        <fieldset class="project-settings__field">
          <legend class="project-settings__label">
            {{ t('projects.settings.iconLegend') }}
          </legend>
          <div
            class="project-settings__icon-grid"
            role="radiogroup"
            [attr.aria-label]="t('projects.settings.iconLegend')"
          >
            @for (option of icons; track option) {
              <button
                type="button"
                class="project-settings__icon-button"
                [class.is-selected]="icon() === option"
                [attr.aria-pressed]="icon() === option"
                (click)="icon.set(option)"
              >
                <app-persona-avatar [icon]="option" [color]="color()" [size]="28" />
              </button>
            }
          </div>
        </fieldset>

        <fieldset class="project-settings__field">
          <legend class="project-settings__label">
            {{ t('projects.settings.colourLegend') }}
          </legend>
          <div
            class="project-settings__color-row"
            role="radiogroup"
            [attr.aria-label]="t('projects.settings.colourLegend')"
          >
            @for (option of colors; track option) {
              <button
                type="button"
                class="project-settings__color-swatch"
                [class]="'project-settings__color-swatch--' + option"
                [class.is-selected]="color() === option"
                [attr.aria-label]="
                  t('personas.editor.colourOption', { colour: option })
                "
                [attr.aria-pressed]="color() === option"
                (click)="color.set(option)"
              ></button>
            }
          </div>
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
      background: var(--cog-surface-sunken, var(--cog-surface));
    }

    .project-settings__preview-text {
      display: grid;
      gap: 2px;
      min-width: 0;
    }

    .project-settings__preview-name {
      color: var(--cog-text);
      font-weight: var(--cog-fw-semibold);
      font-size: var(--cog-fs-body-lg, 16px);
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

    .project-settings__icon-grid {
      display: grid;
      grid-template-columns: repeat(8, 1fr);
      gap: var(--cog-space-075);
    }

    .project-settings__icon-button {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      aspect-ratio: 1;
      border: 1px solid transparent;
      border-radius: var(--cog-radius-sm);
      background: transparent;
      cursor: pointer;
      transition: border-color var(--cog-dur-fast) var(--cog-ease-standard);
    }

    .project-settings__icon-button:hover {
      border-color: var(--cog-border);
    }

    .project-settings__icon-button.is-selected {
      border-color: var(--cog-brand);
      box-shadow: 0 0 0 1px var(--cog-brand);
    }

    .project-settings__color-row {
      display: flex;
      flex-wrap: wrap;
      gap: var(--cog-space-100);
    }

    .project-settings__color-swatch {
      inline-size: 28px;
      block-size: 28px;
      border-radius: 999px;
      border: 2px solid transparent;
      background: var(--swatch-bg, #eef0f3);
      cursor: pointer;
    }

    .project-settings__color-swatch.is-selected {
      border-color: var(--cog-brand);
      box-shadow: 0 0 0 2px var(--cog-surface);
      outline: 2px solid var(--cog-brand);
    }

    .project-settings__color-swatch--green {
      --swatch-bg: #dcfce7;
    }
    .project-settings__color-swatch--blue {
      --swatch-bg: #dbeafe;
    }
    .project-settings__color-swatch--indigo {
      --swatch-bg: #e0e7ff;
    }
    .project-settings__color-swatch--violet {
      --swatch-bg: #ede9fe;
    }
    .project-settings__color-swatch--teal {
      --swatch-bg: #ccfbf1;
    }
    .project-settings__color-swatch--sky {
      --swatch-bg: #e0f2fe;
    }
    .project-settings__color-swatch--amber {
      --swatch-bg: #fef3c7;
    }
    .project-settings__color-swatch--orange {
      --swatch-bg: #ffedd5;
    }
    .project-settings__color-swatch--pink {
      --swatch-bg: #fce7f3;
    }
    .project-settings__color-swatch--slate {
      --swatch-bg: #eef0f3;
    }
    /* "No fill": a surface circle with a hairline border and a diagonal slash. */
    .project-settings__color-swatch--transparent {
      background:
        linear-gradient(
          to top right,
          transparent calc(50% - 1px),
          var(--cog-text-subtlest, #94a3b8) calc(50% - 1px),
          var(--cog-text-subtlest, #94a3b8) calc(50% + 1px),
          transparent calc(50% + 1px)
        ),
        var(--cog-surface, #fff);
      box-shadow: inset 0 0 0 1px var(--cog-border, #e2e8f0);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectSettingsDialogComponent {
  private readonly _dialogRef = inject(DialogRef<void>);
  private readonly _projects = inject(ProjectService);
  private readonly _data: { projectId: string } = inject(DIALOG_DATA);

  protected readonly icons = projectIcons;
  protected readonly colors = projectColors;

  private readonly _project = computed(() =>
    this._projects.projects().find((p) => p.record.id === this._data.projectId),
  );

  protected readonly name = signal('');
  protected readonly description = signal('');
  protected readonly icon = signal<ProjectIcon>(defaultProjectIcon);
  protected readonly color = signal<ProjectColor>(defaultProjectColor);
  protected readonly saving = signal(false);

  protected readonly canSave = computed(() => this.name().trim() !== '');

  constructor() {
    const project = this._project();
    if (project) {
      this.name.set(project.decryptedData.name);
      this.description.set(project.decryptedData.description);
      this.icon.set(project.decryptedData.icon);
      this.color.set(project.decryptedData.color);
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
