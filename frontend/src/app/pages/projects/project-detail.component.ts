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

import { CognosBreadcrumbsComponent, CognosButtonComponent } from '@cognos/ui-angular';

import { ProjectConversationService } from '@app/services/project-conversation.service';
import { ProjectService } from '@app/services/project.service';

@Component({
  selector: 'app-project-detail',
  standalone: true,
  imports: [
    FormsModule,
    RouterLink,
    TranslocoModule,
    CognosBreadcrumbsComponent,
    CognosButtonComponent,
  ],
  templateUrl: './project-detail.component.html',
  styleUrl: './project-detail.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectDetailComponent {
  private readonly _projects = inject(ProjectService);
  private readonly _projectConversations = inject(ProjectConversationService);
  private readonly _router = inject(Router);

  // Bound from the `:projectId` route param via withComponentInputBinding().
  readonly projectId = input.required<string>();

  protected readonly project = computed(() =>
    this._projects.projects().find((project) => project.record.id === this.projectId()),
  );

  protected readonly conversations = computed(() =>
    this._projectConversations.conversationsFor(this.projectId())(),
  );

  protected readonly editing = signal(false);
  protected readonly confirmingDelete = signal(false);
  protected readonly saving = signal(false);
  protected readonly name = signal('');
  protected readonly description = signal('');

  protected readonly chatName = signal('');
  protected readonly creatingChat = signal(false);

  constructor() {
    // Keep the service's "selected project" in sync with the routed id so
    // other surfaces (e.g. a future sidebar highlight) can react to it.
    effect(() => {
      this._projects.select(this.projectId());
    });
  }

  protected startEdit(): void {
    const project = this.project();
    if (!project) {
      return;
    }
    this.name.set(project.decryptedData.name);
    this.description.set(project.decryptedData.description);
    this.editing.set(true);
  }

  protected cancelEdit(): void {
    this.editing.set(false);
  }

  protected save(): void {
    const name = this.name().trim();
    if (name === '' || this.saving()) {
      return;
    }
    this.saving.set(true);
    this._projects
      .updateProject(this.projectId(), {
        version: '1',
        name,
        description: this.description().trim(),
      })
      .subscribe({
        next: () => {
          this.saving.set(false);
          this.editing.set(false);
        },
        error: () => {
          this.saving.set(false);
        },
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
