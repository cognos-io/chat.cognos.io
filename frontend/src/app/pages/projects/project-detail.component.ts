import { Dialog } from '@angular/cdk/dialog';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';

import {
  CognosBreadcrumbsComponent,
  CognosButtonComponent,
  CognosIconButtonComponent,
  CognosIconComponent,
  CognosMenuComponent,
  CognosMenuItem,
} from '@cognos/ui-angular';

import { PersonaAvatarComponent } from '@app/components/personas/persona-avatar/persona-avatar.component';
import { ProjectSettingsDialogComponent } from '@app/components/projects/project-settings-dialog/project-settings-dialog.component';
import {
  Conversation,
  partitionConversationsByPinned,
} from '@app/interfaces/conversation';
import { ConversationProjectActionsService } from '@app/services/conversation-project-actions.service';
import { NEW_PROJECT_CHAT_TITLE } from '@app/services/message.service';
import { ProjectConversationService } from '@app/services/project-conversation.service';
import { ProjectService } from '@app/services/project.service';
import { UserPreferencesService } from '@app/services/user-preferences.service';
import { cognosDialogOptions } from '@app/utils/dialog-options';
import { relativeDate } from '@app/utils/relative-date';

@Component({
  selector: 'app-project-detail',
  standalone: true,
  imports: [
    FormsModule,
    RouterLink,
    TranslocoModule,
    CognosBreadcrumbsComponent,
    CognosButtonComponent,
    CognosIconButtonComponent,
    CognosIconComponent,
    CognosMenuComponent,
    PersonaAvatarComponent,
  ],
  templateUrl: './project-detail.component.html',
  styleUrl: './project-detail.component.css',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ProjectDetailComponent {
  private readonly _projects = inject(ProjectService);
  private readonly _projectConversations = inject(ProjectConversationService);
  private readonly _preferences = inject(UserPreferencesService);
  private readonly _transloco = inject(TranslocoService);
  private readonly _router = inject(Router);
  private readonly _dialog = inject(Dialog);
  private readonly _elementRef = inject(ElementRef<HTMLElement>);
  private readonly _projectActions = inject(ConversationProjectActionsService);

  // Bound from the `:projectId` route param via withComponentInputBinding().
  readonly projectId = input.required<string>();

  protected readonly project = computed(() =>
    this._projects.projects().find((project) => project.record.id === this.projectId()),
  );

  // Pinned chats first (in pin order), then the rest by last activity — the
  // same ordering as the sidebar, scoped to this project's chats.
  protected readonly conversations = computed(() => {
    const all = this._projectConversations.conversationsFor(this.projectId())();
    const { pinned, recent } = partitionConversationsByPinned(
      all,
      this._preferences.pinnedConversationIds(),
    );
    return [...pinned, ...recent];
  });

  protected isPinned(conversationId: string): boolean {
    return this._preferences.isConversationPinned(conversationId);
  }

  // Human-friendly last-activity label (today / yesterday / N days ago / last
  // week / YYYY-MM-DD) for a project chat.
  protected lastActivityLabel(conversation: Conversation): string {
    const result = relativeDate(
      conversation.record.last_activity_at ?? conversation.record.updated,
    );
    if (!result) {
      return '';
    }
    if ('absolute' in result) {
      return result.absolute;
    }
    return this._transloco.translate(
      result.key,
      'params' in result ? result.params : undefined,
    );
  }

  protected readonly confirmingDelete = signal(false);

  // Inline project-instructions editor state.
  protected readonly editingInstructions = signal(false);
  protected readonly instructionsDraft = signal('');
  protected readonly savingInstructions = signal(false);

  protected readonly creatingChat = signal(false);
  protected readonly openMenuConversationId = signal<string | null>(null);

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

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    const target = event.target;
    if (target instanceof Node && !this._elementRef.nativeElement.contains(target)) {
      this.openMenuConversationId.set(null);
    }
  }

  protected toggleConversationMenu(conversationId: string, event: Event): void {
    event.stopPropagation();
    this.openMenuConversationId.update((openId) =>
      openId === conversationId ? null : conversationId,
    );
  }

  protected conversationMenuItems(conversation: Conversation): CognosMenuItem[] {
    return this.conversationMenuEntries(conversation).map((entry) => ({
      title: entry.title,
      icon: entry.icon,
    }));
  }

  protected onConversationMenuSelect(index: number, conversation: Conversation): void {
    const entry = this.conversationMenuEntries(conversation)[index];
    this.openMenuConversationId.set(null);
    if (!entry) {
      return;
    }
    if (entry.action === 'move-to-project') {
      this._projectActions.openMoveDialog(conversation);
    } else {
      this._projectActions.removeFromProject(conversation);
    }
  }

  private conversationMenuEntries(
    conversation: Conversation,
  ): Array<CognosMenuItem & { action: 'move-to-project' | 'remove-from-project' }> {
    const entries: Array<
      CognosMenuItem & { action: 'move-to-project' | 'remove-from-project' }
    > = [];
    if (this._projectActions.canMoveToProject(conversation)) {
      entries.push({
        action: 'move-to-project',
        title: this._transloco.translate('chat.projectActions.moveToProject'),
        icon: 'folder',
      });
    }
    if (this._projectActions.canRemoveFromProject(conversation)) {
      entries.push({
        action: 'remove-from-project',
        title: this._transloco.translate('chat.projectActions.removeFromProject'),
        icon: 'x',
      });
    }
    return entries;
  }

  protected startChat(): void {
    const project = this.project();
    if (!project || this.creatingChat()) {
      return;
    }
    this.creatingChat.set(true);
    this._projectConversations
      .create(project, { title: NEW_PROJECT_CHAT_TITLE })
      .subscribe({
        next: (conversation) => {
          this.creatingChat.set(false);
          this._router.navigate(['/', 'c', conversation.record.id]);
        },
        error: () => {
          this.creatingChat.set(false);
        },
      });
  }
}
