import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  inject,
  signal,
} from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';

import {
  CognosButtonComponent,
  CognosDialogActionsComponent,
  CognosDialogSurfaceComponent,
  CognosEmptyStateComponent,
  CognosListComponent,
  CognosListItemComponent,
  CognosSearchFieldComponent,
} from '@cognos/ui-angular';

import { Conversation } from '@app/interfaces/conversation';
import { Project } from '@app/interfaces/project';
import { ProjectService } from '@app/services/project.service';

interface ConversationProjectDialogData {
  conversation: Conversation;
}

@Component({
  selector: 'app-conversation-project-dialog',
  standalone: true,
  imports: [
    TranslocoModule,
    CognosButtonComponent,
    CognosDialogActionsComponent,
    CognosDialogSurfaceComponent,
    CognosEmptyStateComponent,
    CognosListComponent,
    CognosListItemComponent,
    CognosSearchFieldComponent,
  ],
  template: `
    <cog-dialog-surface
      *transloco="let t"
      [title]="t('chat.projectActions.moveDialogTitle')"
      [closeLabel]="t('common.close')"
      [footer]="true"
      [width]="520"
      (close)="close()"
    >
      <div class="conversation-project-dialog">
        <p class="conversation-project-dialog__intro">
          {{
            t('chat.projectActions.moveDialogIntro', {
              title: data.conversation.decryptedData.title,
            })
          }}
        </p>

        @if (projects().length > 4) {
          <cog-search-field
            [value]="query()"
            [placeholder]="t('chat.projectActions.searchProjects')"
            [ariaLabel]="t('chat.projectActions.searchProjects')"
            (valueChange)="query.set($event)"
          />
        }

        @if (filteredProjects().length === 0) {
          <cog-empty-state
            [title]="t('chat.projectActions.noProjectsTitle')"
            [message]="t('chat.projectActions.noProjectsMessage')"
          />
        } @else {
          <cog-list>
            @for (project of filteredProjects(); track project.record.id) {
              <cog-list-item>
                <button
                  type="button"
                  class="conversation-project-dialog__project"
                  [class.conversation-project-dialog__project--selected]="
                    selectedProjectId() === project.record.id
                  "
                  (click)="selectedProjectId.set(project.record.id)"
                >
                  <span class="conversation-project-dialog__project-name">
                    {{ project.decryptedData.name }}
                  </span>
                  @if (project.decryptedData.description) {
                    <span class="conversation-project-dialog__project-description">
                      {{ project.decryptedData.description }}
                    </span>
                  }
                </button>
              </cog-list-item>
            }
          </cog-list>
        }
      </div>

      <cog-dialog-actions cogDialogFooter>
        <cog-button appearance="subtle" (click)="close()">
          {{ t('common.cancel') }}
        </cog-button>
        <cog-button
          appearance="primary"
          icon="folder"
          [disabled]="!selectedProject()"
          (click)="move()"
        >
          {{ t('chat.projectActions.move') }}
        </cog-button>
      </cog-dialog-actions>
    </cog-dialog-surface>
  `,
  styles: `
    .conversation-project-dialog {
      display: grid;
      gap: var(--cog-space-150);
    }

    .conversation-project-dialog__intro {
      margin: 0;
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-body);
      line-height: var(--cog-lh-body);
    }

    .conversation-project-dialog__project {
      display: grid;
      gap: var(--cog-space-025);
      inline-size: 100%;
      border: var(--cog-border-width) solid transparent;
      border-radius: var(--cog-radius-sm);
      background: transparent;
      color: var(--cog-text);
      cursor: pointer;
      font: inherit;
      padding: var(--cog-space-100) var(--cog-space-150);
      text-align: start;
      transition:
        background-color var(--cog-dur-fast) var(--cog-ease-standard),
        border-color var(--cog-dur-fast) var(--cog-ease-standard);
    }

    .conversation-project-dialog__project:hover {
      background: var(--cog-surface-hover);
    }

    .conversation-project-dialog__project--selected {
      background: var(--cog-selected-bg);
      border-color: var(--cog-selected-border);
    }

    .conversation-project-dialog__project:focus-visible {
      outline: var(--cog-border-width-strong) solid var(--cog-brand);
      outline-offset: var(--cog-border-width-strong);
    }

    .conversation-project-dialog__project-name {
      font-weight: var(--cog-fw-semibold);
    }

    .conversation-project-dialog__project-description {
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-caption);
      line-height: var(--cog-lh-caption);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConversationProjectDialogComponent {
  protected readonly data = inject<ConversationProjectDialogData>(DIALOG_DATA);
  private readonly _dialogRef = inject(DialogRef<Project | undefined>);
  private readonly _projects = inject(ProjectService);

  protected readonly query = signal('');
  protected readonly selectedProjectId = signal('');

  protected readonly projects = computed(() =>
    this._projects
      .adminProjects()
      .filter(
        (project) =>
          project.record.id !== this.data.conversation.record.project &&
          !project.record.archived_at,
      ),
  );

  protected readonly filteredProjects = computed(() => {
    const query = this.query().trim().toLocaleLowerCase();
    if (!query) {
      return this.projects();
    }
    return this.projects().filter((project) =>
      project.decryptedData.name.toLocaleLowerCase().includes(query),
    );
  });

  protected readonly selectedProject = computed(
    () =>
      this.projects().find(
        (project) => project.record.id === this.selectedProjectId(),
      ) ?? null,
  );

  protected close(): void {
    this._dialogRef.close(undefined);
  }

  protected move(): void {
    const project = this.selectedProject();
    if (project) {
      this._dialogRef.close(project);
    }
  }
}
