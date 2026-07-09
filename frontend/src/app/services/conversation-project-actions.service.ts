import { Dialog } from '@angular/cdk/dialog';
import { Injectable, inject } from '@angular/core';

import { filter, switchMap } from 'rxjs';

import { TranslocoService } from '@jsverse/transloco';

import { CognosToastService } from '@cognos/ui-angular';

import { ConversationProjectDialogComponent } from '@app/components/projects/conversation-project-dialog.component';
import { Conversation } from '@app/interfaces/conversation';
import { Project } from '@app/interfaces/project';
import { cognosDialogOptions } from '@app/utils/dialog-options';

import { ProjectConversationService } from './project-conversation.service';
import { ProjectService } from './project.service';

@Injectable({
  providedIn: 'root',
})
export class ConversationProjectActionsService {
  private readonly _dialog = inject(Dialog);
  private readonly _projectConversations = inject(ProjectConversationService);
  private readonly _projects = inject(ProjectService);
  private readonly _toast = inject(CognosToastService);
  private readonly _transloco = inject(TranslocoService);

  canMoveToProject(conversation: Conversation): boolean {
    const currentProjectId = conversation.record.project;
    if (currentProjectId && !this._projects.canAdminProject(currentProjectId)) {
      return false;
    }
    return this._projects
      .adminProjects()
      .some(
        (project) =>
          project.record.id !== currentProjectId && !project.record.archived_at,
      );
  }

  canRemoveFromProject(conversation: Conversation): boolean {
    const projectId = conversation.record.project;
    return !!projectId && this._projects.canAdminProject(projectId);
  }

  openMoveDialog(conversation: Conversation): void {
    this._dialog
      .open<Project | undefined>(ConversationProjectDialogComponent, {
        ...cognosDialogOptions(
          this._transloco.translate('chat.projectActions.moveDialogTitle'),
        ),
        data: { conversation },
      })
      .closed.pipe(
        filter((project): project is Project => !!project),
        switchMap((project) =>
          this._projectConversations.moveToProject(conversation, project),
        ),
      )
      .subscribe({
        next: () => {
          this._toast.notify({
            title: this._transloco.translate('chat.projectActions.movedToast'),
          });
        },
        error: () => {
          this._toast.notify({
            title: this._transloco.translate('chat.projectActions.moveError'),
            tone: 'danger',
          });
        },
      });
  }

  removeFromProject(conversation: Conversation): void {
    this._projectConversations.removeFromProject(conversation).subscribe({
      next: () => {
        this._toast.notify({
          title: this._transloco.translate('chat.projectActions.removedToast'),
        });
      },
      error: () => {
        this._toast.notify({
          title: this._transloco.translate('chat.projectActions.removeError'),
          tone: 'danger',
        });
      },
    });
  }
}
