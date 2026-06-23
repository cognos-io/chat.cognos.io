import { Dialog } from '@angular/cdk/dialog';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';

import {
  CognosBreadcrumbsComponent,
  CognosButtonComponent,
  CognosIconComponent,
} from '@cognos/ui-angular';

import { PersonaAvatarComponent } from '@app/components/personas/persona-avatar/persona-avatar.component';
import { ProjectSettingsDialogComponent } from '@app/components/projects/project-settings-dialog/project-settings-dialog.component';
import { ProjectConversationService } from '@app/services/project-conversation.service';
import { ProjectService } from '@app/services/project.service';
import { cognosDialogOptions } from '@app/utils/dialog-options';

@Component({
  selector: 'app-project-detail',
  standalone: true,
  imports: [
    FormsModule,
    RouterLink,
    TranslocoModule,
    CognosBreadcrumbsComponent,
    CognosButtonComponent,
    CognosIconComponent,
    PersonaAvatarComponent,
  ],
  templateUrl: './project-detail.component.html',
  styleUrl: './project-detail.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectDetailComponent {
  private readonly _projects = inject(ProjectService);
  private readonly _projectConversations = inject(ProjectConversationService);
  private readonly _router = inject(Router);
  private readonly _dialog = inject(Dialog);

  // Bound from the `:projectId` route param via withComponentInputBinding().
  readonly projectId = input.required<string>();

  protected readonly project = computed(() =>
    this._projects.projects().find((project) => project.record.id === this.projectId()),
  );

  protected readonly conversations = computed(() =>
    this._projectConversations.conversationsFor(this.projectId())(),
  );

  protected readonly confirmingDelete = signal(false);

  // Inline project-instructions editor state.
  protected readonly editingInstructions = signal(false);
  protected readonly instructionsDraft = signal('');
  protected readonly savingInstructions = signal(false);

  protected readonly chatName = signal('');
  protected readonly creatingChat = signal(false);

  constructor() {
    // Keep the service's "selected project" in sync with the routed id so
    // other surfaces (e.g. a sidebar highlight) can react to it.
    effect(() => {
      this._projects.select(this.projectId());
    });
  }

  protected openSettings(): void {
    this._dialog.open(ProjectSettingsDialogComponent, {
      ...cognosDialogOptions,
      data: { projectId: this.projectId() },
    });
  }

  protected startEditInstructions(): void {
    const project = this.project();
    if (!project) {
      return;
    }
    this.instructionsDraft.set(project.decryptedData.instructions);
    this.editingInstructions.set(true);
  }

  protected cancelEditInstructions(): void {
    this.editingInstructions.set(false);
  }

  protected saveInstructions(): void {
    const project = this.project();
    if (!project || this.savingInstructions()) {
      return;
    }
    this.savingInstructions.set(true);
    this._projects
      .updateProject(this.projectId(), {
        ...project.decryptedData,
        instructions: this.instructionsDraft().trim(),
      })
      .subscribe({
        next: () => {
          this.savingInstructions.set(false);
          this.editingInstructions.set(false);
        },
        error: () => this.savingInstructions.set(false),
      });
  }

  protected requestDelete(): void {
    this.confirmingDelete.set(true);
  }

  protected cancelDelete(): void {
    this.confirmingDelete.set(false);
  }

  protected confirmDelete(): void {
    this._projects.deleteProject$.next(this.projectId());
    this._router.navigate(['/account/projects']);
  }

  // Breadcrumb crumbs, in order: Cognos, Projects. The final crumb (the project
  // name) is the current page and has no route.
  private readonly breadcrumbRoutes = ['/', '/account/projects'];

  protected onBreadcrumb(index: number): void {
    const route = this.breadcrumbRoutes[index];
    if (route) {
      this._router.navigateByUrl(route);
    }
  }

  protected openConversation(conversationId: string): void {
    this._router.navigate(['/', 'c', conversationId]);
  }

  protected startChat(): void {
    const project = this.project();
    if (!project || this.creatingChat()) {
      return;
    }
    const title = this.chatName().trim() || 'New chat';
    this.creatingChat.set(true);
    this._projectConversations.create(project, { title }).subscribe({
      next: (conversation) => {
        this.creatingChat.set(false);
        this.chatName.set('');
        this._router.navigate(['/', 'c', conversation.record.id]);
      },
      error: () => {
        this.creatingChat.set(false);
      },
    });
  }
}
