import { Dialog } from '@angular/cdk/dialog';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { Base64 } from 'js-base64';

import {
  CognosAvatarComponent,
  type CognosBreadcrumbItem,
  CognosBreadcrumbsComponent,
  CognosButtonComponent,
  CognosIconButtonComponent,
  CognosIconComponent,
  CognosMenuComponent,
  type CognosMenuItem,
  CognosSecurityModalComponent,
} from '@cognos/ui-angular';

import { ConfirmationDialogComponent } from '@app/components/confirmation-dialog/confirmation-dialog.component';
import { EditConversationDialogComponent } from '@app/components/edit-conversation-dialog/edit-conversation-dialog.component';
import { ShareConversationDialogComponent } from '@app/components/share-conversation-dialog/share-conversation-dialog.component';
import { Conversation } from '@app/interfaces/conversation';
import { AuthService } from '@app/services/auth.service';
import { ConversationService } from '@app/services/conversation.service';
import { DeviceService } from '@app/services/device.service';
import { MessageService } from '@app/services/message.service';
import { ProjectService } from '@app/services/project.service';
import { PublicShareService } from '@app/services/public-share.service';
import { RedactionService } from '@app/services/redaction.service';
import { VaultService } from '@app/services/vault.service';
import { cognosDialogOptions } from '@app/utils/dialog-options';

type HeaderMenuAction =
  | 'share'
  | 'rename'
  | 'export'
  | 'toggle-redaction-visibility'
  | 'clear'
  | 'delete';

type HeaderMenuEntry = CognosMenuItem & { action: HeaderMenuAction };

@Component({
  selector: 'app-chat-header',
  standalone: true,
  imports: [
    CognosAvatarComponent,
    CognosBreadcrumbsComponent,
    CognosButtonComponent,
    CognosIconButtonComponent,
    CognosIconComponent,
    CognosMenuComponent,
    CognosSecurityModalComponent,
    TranslocoModule,
  ],
  templateUrl: './chat-header.component.html',
  styleUrl: './chat-header.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ChatHeaderComponent {
  private readonly _authService = inject(AuthService);
  private readonly _dialog = inject(Dialog);
  private readonly _elementRef = inject(ElementRef<HTMLElement>);
  private readonly _messageService = inject(MessageService);
  private readonly _router = inject(Router);
  private readonly _vaultService = inject(VaultService);
  private readonly _device = inject(DeviceService);
  private readonly _publicShare = inject(PublicShareService);
  private readonly _transloco = inject(TranslocoService);
  private readonly _projectService = inject(ProjectService);
  private readonly _redaction = inject(RedactionService);

  readonly conversationService = inject(ConversationService);

  readonly menuOpen = signal(false);
  readonly securityOpen = signal(false);
  // True when the current conversation has a live public share link, so the
  // Share control can warn the user that this chat is publicly readable.
  readonly isShared = signal(false);

  constructor() {
    // Re-check the public-share state whenever the active conversation changes.
    effect(() => {
      const conversation = this.conversationService.conversation();
      if (!conversation) {
        this.isShared.set(false);
        return;
      }
      this._refreshShareState(conversation);
    });
  }

  // Sharing is only meaningful for a persisted conversation; temporary chats
  // have nothing the server can hand to a public reader.
  readonly canShare = computed(() => this._conversationId() !== null);

  // Project conversations can't be publicly shared (public project sharing is a
  // non-goal, and a link would bypass project membership). The Share control
  // stays visible but disabled, with a tooltip explaining why.
  readonly isProjectConversation = computed(
    () => !!this.conversationService.conversation()?.record.project,
  );

  // The current user's avatar only earns its place once a chat actually has
  // other people in it. Invites and projects don't exist yet, so there are
  // never other participants today — wire this to the participant list when
  // that lands.
  readonly hasOtherPeople = computed(() => false);

  readonly title = computed(() => {
    const title = this.conversationService.conversation()?.decryptedData.title;

    if (title) {
      return title;
    }

    return this.conversationService.isTemporaryConversation()
      ? this._transloco.translate('chat.header.temporaryChat')
      : this._transloco.translate('chat.header.newChat');
  });

  // The breadcrumb trail above the title: Cognos → (project, if any) → chat.
  // Empty until a conversation is loaded (a fresh/temporary chat shows none).
  // `route` drives navigation via the breadcrumbs' itemSelect output, since the
  // breadcrumb items themselves only carry a label.
  private readonly _breadcrumbTrail = computed<{ label: string; route?: string }[]>(
    () => {
      const conversation = this.conversationService.conversation();
      if (!conversation) {
        return [];
      }

      const trail: { label: string; route?: string }[] = [
        { label: 'Cognos', route: '/' },
      ];

      const projectId = conversation.record.project;
      if (projectId) {
        const project = this._projectService
          .projects()
          .find((candidate) => candidate.record.id === projectId);
        trail.push({
          label:
            project?.decryptedData.name ?? this._transloco.translate('projects.title'),
          route: `/account/projects/${projectId}`,
        });
      }

      trail.push({ label: this.title() });
      return trail;
    },
  );

  readonly breadcrumbs = computed<CognosBreadcrumbItem[]>(() => {
    const trail = this._breadcrumbTrail();
    return trail.map((crumb, index) => ({
      label: crumb.label,
      current: index === trail.length - 1,
    }));
  });

  onBreadcrumb(index: number): void {
    const route = this._breadcrumbTrail()[index]?.route;
    if (route) {
      this._router.navigateByUrl(route);
    }
  }

  readonly currentUserName = computed(() =>
    displayNameFromEmail(this._authService.email()),
  );

  readonly hasDeviceKey = computed(() => !!this._vaultService.keyPair());

  // Format the vault's canonical fingerprint for display; never re-hash here so
  // the value always matches the trusted-device context.
  readonly fingerprint = computed(() =>
    formatFingerprint(this._vaultService.publicKeyFingerprint()),
  );

  private readonly _conversationId = computed(
    () => this.conversationService.conversation()?.record.id ?? null,
  );

  // Whether the active conversation has any decrypted redaction mappings. Reads
  // revision() so it recomputes when mappings finish loading.
  private readonly _hasRedactions = computed(() => {
    this._redaction.revision();
    return this._redaction.entriesFor(this._conversationId() ?? undefined).size > 0;
  });

  private readonly _canClearMessages = computed(
    () =>
      this.conversationService.isTemporaryConversation() &&
      this._messageService.messages().length > 0,
  );

  private readonly _menuEntries = computed<HeaderMenuEntry[]>(() => {
    const entries: HeaderMenuEntry[] = [];
    const hasConversation = this._conversationId() !== null;

    if (hasConversation) {
      // The dedicated Share button is hidden on mobile, so surface sharing in
      // the overflow menu there instead.
      if (this._device.isMobile()) {
        entries.push({
          action: 'share',
          title: this.isShared()
            ? this._transloco.translate('chat.header.shared')
            : this._transloco.translate('chat.header.share'),
          icon: this.isShared() ? 'link' : 'user-plus',
          disabled: this.isProjectConversation(),
        });
      }
      entries.push({
        action: 'rename',
        title: this._transloco.translate('chat.header.rename'),
        icon: 'pencil',
      });
      entries.push({
        action: 'export',
        title: this._transloco.translate('chat.header.export'),
        icon: 'download',
        disabled: true,
        trailing: this._transloco.translate('chat.header.soon'),
      });

      // Mask/reveal redacted values in the rendered chat — only worth offering
      // once this conversation actually has something redacted.
      if (this._hasRedactions()) {
        const hidden = this._redaction.valuesHidden();
        entries.push({
          action: 'toggle-redaction-visibility',
          title: hidden
            ? this._transloco.translate('chat.header.showValues')
            : this._transloco.translate('chat.header.hideValues'),
          icon: hidden ? 'eye' : 'eye-off',
        });
      }
    }

    if (this._canClearMessages()) {
      entries.push({
        action: 'clear',
        title: this._transloco.translate('chat.header.clearMessages'),
        icon: 'eraser',
      });
    }

    if (hasConversation) {
      entries.push({
        action: 'delete',
        title: this._transloco.translate('chat.header.delete'),
        icon: 'x',
      });
    }

    return entries;
  });

  readonly menuItems = computed<CognosMenuItem[]>(() =>
    this._menuEntries().map((entry) => ({
      title: entry.title,
      icon: entry.icon,
      disabled: entry.disabled,
      trailing: entry.trailing,
    })),
  );

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
    const target = event.target;

    if (!(target instanceof Node)) {
      return;
    }

    if (!this._elementRef.nativeElement.contains(target)) {
      this.menuOpen.set(false);
    }
  }

  toggleMenu(event: Event) {
    event.preventDefault();
    event.stopPropagation();
    this.menuOpen.update((open) => !open);
  }

  onMenuSelect(index: number) {
    const entry = this._menuEntries()[index];
    this.menuOpen.set(false);

    if (!entry) {
      return;
    }

    switch (entry.action) {
      case 'share':
        this.onShare();
        break;
      case 'rename':
        this.onRename();
        break;
      case 'toggle-redaction-visibility':
        this._redaction.toggleValuesHidden();
        break;
      case 'clear':
        this.onClearMessages();
        break;
      case 'delete':
        this.onDelete();
        break;
      case 'export':
        // Export is not implemented yet; the menu item is disabled.
        break;
    }
  }

  openSecurity() {
    this.securityOpen.set(true);
  }

  closeSecurity() {
    this.securityOpen.set(false);
  }

  onShare() {
    const conversationId = this._conversationId();

    if (!conversationId || this.isProjectConversation()) {
      return;
    }

    this._dialog
      .open(ShareConversationDialogComponent, {
        ...cognosDialogOptions,
        data: { conversationId },
      })
      .closed.subscribe(() => {
        // The dialog may have created or revoked the share; resync the badge.
        const conversation = this.conversationService.conversation();
        if (conversation) {
          this._refreshShareState(conversation);
        }
      });
  }

  private _refreshShareState(conversation: Conversation) {
    const id = conversation.record.id;
    this._publicShare.existingShareUrl(conversation).subscribe({
      next: (url) => {
        // Ignore a late response for a conversation the user already left.
        if (this._conversationId() === id) {
          this.isShared.set(url !== null);
        }
      },
      error: () => {
        if (this._conversationId() === id) {
          this.isShared.set(false);
        }
      },
    });
  }

  private onRename() {
    const conversationId = this._conversationId();

    if (!conversationId) {
      return;
    }

    this._dialog.open(EditConversationDialogComponent, {
      ...cognosDialogOptions,
      data: { conversationId },
    });
  }

  private onDelete() {
    const conversationId = this._conversationId();

    if (!conversationId) {
      return;
    }

    this._dialog
      .open(ConfirmationDialogComponent, {
        ...cognosDialogOptions,
        data: {
          message: this._transloco.translate('chat.header.deleteConfirm'),
        },
      })
      .closed.subscribe((result) => {
        if (result) {
          this.conversationService.deleteConversation$.next(conversationId);
          this._router.navigate(['/']);
        }
      });
  }

  private onClearMessages() {
    this._messageService.resetState();
  }
}

function displayNameFromEmail(email: string): string {
  const local = email.split('@')[0] ?? '';
  const parts = local.split(/[._-]+/).filter(Boolean);

  if (parts.length === 0) {
    return email;
  }

  return parts.map((part) => part[0].toUpperCase() + part.slice(1)).join(' ');
}

function formatFingerprint(base64Fingerprint: string): string {
  if (!base64Fingerprint) {
    return '';
  }

  const hex = Array.from(Base64.toUint8Array(base64Fingerprint).slice(0, 6))
    .map((byte) => byte.toString(16).padStart(2, '0').toUpperCase())
    .join('');

  return hex.match(/.{1,4}/g)?.join(' · ') ?? hex;
}
