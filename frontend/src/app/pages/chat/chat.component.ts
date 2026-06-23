import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterModule } from '@angular/router';

import { filter } from 'rxjs';

import { TranslocoModule } from '@jsverse/transloco';

import {
  CognosButtonComponent,
  CognosDesktopShellComponent,
  CognosIconComponent,
  CognosMobileShellComponent,
  CognosTextFieldComponent,
} from '@cognos/ui-angular';

import { BillingLockBannerComponent } from '@app/components/billing/billing-lock-banner/billing-lock-banner.component';
import { BillingPastDueBannerComponent } from '@app/components/billing/billing-past-due-banner/billing-past-due-banner.component';
import { ChatHeaderComponent } from '@app/components/chat/chat-header/chat-header.component';
import { ConversationListItemComponent } from '@app/components/chat/conversation-list/conversation-list-item/conversation-list-item.component';
import { SidebarProfileComponent } from '@app/components/chat/sidebar-profile/sidebar-profile.component';
import { TrialCreditCardComponent } from '@app/components/chat/trial-credit-card/trial-credit-card.component';
import { CognosLogoComponent } from '@app/components/cognos-logo/cognos-logo.component';
import { LoadingIndicatorComponent } from '@app/components/loading-indicator/loading-indicator.component';
import { PersonaAvatarComponent } from '@app/components/personas/persona-avatar/persona-avatar.component';
import { SidebarAccountActionsComponent } from '@app/components/sidebar-account-actions/sidebar-account-actions.component';
import { SidebarBrandComponent } from '@app/components/sidebar-brand/sidebar-brand.component';
import { VaultUnlockGateDirective } from '@app/directives/vault-unlock-gate.directive';
import { Conversation } from '@app/interfaces/conversation';
import { BillingService } from '@app/services/billing.service';
import { DeviceService } from '@app/services/device.service';
import { MessageService } from '@app/services/message.service';
import { ProjectConversationService } from '@app/services/project-conversation.service';
import { ProjectService } from '@app/services/project.service';
import { VaultService } from '@app/services/vault.service';

import { environment } from '@environments/environment';

import { ConversationService } from '../../services/conversation.service';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    CognosButtonComponent,
    CognosDesktopShellComponent,
    CognosMobileShellComponent,
    CognosIconComponent,
    CognosLogoComponent,
    CognosTextFieldComponent,
    ChatHeaderComponent,
    ConversationListItemComponent,
    LoadingIndicatorComponent,
    PersonaAvatarComponent,
    SidebarProfileComponent,
    TrialCreditCardComponent,
    BillingLockBannerComponent,
    BillingPastDueBannerComponent,
    SidebarAccountActionsComponent,
    SidebarBrandComponent,
    TranslocoModule,
  ],
  templateUrl: './chat.component.html',
  styleUrl: './chat.component.scss',
  hostDirectives: [VaultUnlockGateDirective],
})
export class ChatComponent {
  private readonly _messageService = inject(MessageService);
  private readonly _vaultService = inject(VaultService);

  readonly router = inject(Router);
  readonly conversationService = inject(ConversationService);
  readonly billing = inject(BillingService);
  readonly device = inject(DeviceService);
  readonly drawerOpen = signal(false);

  // Projects group at the top of the sidebar (flagged while sharing is built).
  private readonly _projectService = inject(ProjectService);
  // Injected so its eager-load runs while the chat shell is alive, merging the
  // user's project conversations into the sidebar list (all chats, recent-first).
  private readonly _projectConversationService = inject(ProjectConversationService);
  readonly projectsEnabled = environment.featureFlags.projects;
  readonly projects = this._projectService.orderedProjects;

  // Projects whose chats are expanded inline in the sidebar. Clicking a
  // project's name still opens its detail page; the chevron toggles this set.
  private readonly _expandedProjects = signal<ReadonlySet<string>>(new Set());

  isProjectExpanded(projectId: string): boolean {
    return this._expandedProjects().has(projectId);
  }

  toggleProject(projectId: string, event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this._expandedProjects.update((current) => {
      const next = new Set(current);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  }

  // The project's chats (newest first) for the inline expanded list; its length
  // is shown as a count next to the project name.
  projectChats(projectId: string): Conversation[] {
    return this._projectConversationService.byProject().get(projectId) ?? [];
  }

  // The persona management page renders in the conversation outlet but brings
  // its own header, so the chat header is hidden while it is active.
  readonly currentUrl = signal(this.router.url);
  readonly isPersonasRoute = computed(() => this.currentUrl().startsWith('/personas'));

  readonly isRestoringVault = computed(
    () => this._vaultService.isRestoring() && !this._vaultService.keyPair(),
  );

  readonly canClearTemporaryMessages = computed(() => {
    return (
      this.conversationService.isTemporaryConversation() &&
      this._messageService.messages().length > 0
    );
  });

  constructor() {
    this.router.events
      .pipe(
        takeUntilDestroyed(),
        filter((event) => event instanceof NavigationEnd),
      )
      .subscribe(() => {
        this.drawerOpen.set(false);
        this.currentUrl.set(this.router.url);
      });
  }

  onNewConversation() {
    if (this.billing.isSendingLocked()) {
      return;
    }

    if (this.canClearTemporaryMessages()) {
      this._messageService.resetState();
    }

    this.drawerOpen.set(false);

    if (this.router.url !== '/') {
      this.router.navigateByUrl('/');
    }
  }

  onSearchChange(value: string) {
    this.conversationService.filter$.next(value);
  }

  openDrawer() {
    this.drawerOpen.set(true);
  }

  closeDrawer() {
    this.drawerOpen.set(false);
  }
}
