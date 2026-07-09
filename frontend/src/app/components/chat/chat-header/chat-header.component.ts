import { Dialog } from '@angular/cdk/dialog';
import { Overlay } from '@angular/cdk/overlay';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
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
  CognosToastService,
} from '@cognos/ui-angular';

import { ConversationMemoryComponent } from '@app/components/chat/conversation-memory/conversation-memory.component';
import { RetentionDialogComponent } from '@app/components/chat/retention-dialog/retention-dialog.component';
import { ConfirmationDialogComponent } from '@app/components/confirmation-dialog/confirmation-dialog.component';
import { EditConversationDialogComponent } from '@app/components/edit-conversation-dialog/edit-conversation-dialog.component';
import { ShareConversationDialogComponent } from '@app/components/share-conversation-dialog/share-conversation-dialog.component';
import { Conversation } from '@app/interfaces/conversation';
import { isMessageFromUser } from '@app/interfaces/message';
import { AuthService } from '@app/services/auth.service';
import { CompactionService } from '@app/services/compaction.service';
import { ConversationDuplicateService } from '@app/services/conversation-duplicate.service';
import { ConversationProjectActionsService } from '@app/services/conversation-project-actions.service';
import { ConversationService } from '@app/services/conversation.service';
import { DeviceService } from '@app/services/device.service';
import { ExportService } from '@app/services/export.service';
import { LanguageService } from '@app/services/language.service';
import { MessageService } from '@app/services/message.service';
import { ModelService } from '@app/services/model.service';
import { PrivacyPanelService } from '@app/services/privacy-panel.service';
import { ProjectService } from '@app/services/project.service';
import { PublicShareService } from '@app/services/public-share.service';
import { RedactionService } from '@app/services/redaction.service';
import { UserPreferencesService } from '@app/services/user-preferences.service';
import { VaultService } from '@app/services/vault.service';
import { cognosDialogOptions } from '@app/utils/dialog-options';
import { buildPrivacyPanelContent } from '@app/utils/privacy-copy';
import {
  conversationRetentionLabelKey,
  effectiveRetentionDays,
  normalizeConversationRetention,
} from '@app/utils/retention';
import { resolveServedModel } from '@app/utils/served-model';

import { environment } from '@environments/environment';

type HeaderMenuAction =
  | 'share'
  | 'rename'
  | 'export'
  | 'duplicate'
  | 'move-to-project'
  | 'remove-from-project'
  | 'memory'
  | 'toggle-conversation-memory'
  | 'toggle-redaction-visibility'
  | 'retention'
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
  private readonly _compaction = inject(CompactionService);
  private readonly _overlay = inject(Overlay);
  private readonly _export = inject(ExportService);
  private readonly _toast = inject(CognosToastService);
  private readonly _duplicate = inject(ConversationDuplicateService);
  private readonly _projectActions = inject(ConversationProjectActionsService);
  private readonly _userPreferences = inject(UserPreferencesService);
  private readonly _destroyRef = inject(DestroyRef);
  private readonly _models = inject(ModelService);
  private readonly _language = inject(LanguageService);

  readonly conversationService = inject(ConversationService);
  readonly privacyPanel = inject(PrivacyPanelService);

  readonly menuOpen = signal(false);
  readonly exporting = signal(false);
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

  // The region/model the panel reports: the latest assistant answer's served_*
  // snapshot (ground truth of what served this chat) if there is one, else the
  // currently-selected model. This is what fixes the old hardcoded "Swiss
  // compute" — the compute-location now reflects the ACTUAL served region.
  private readonly _servedModel = computed(() => {
    const latestAnswer = [...this._messageService.messages()]
      .reverse()
      .find((message) => !isMessageFromUser(message.decryptedData));
    const data = latestAnswer?.decryptedData;
    const model = data?.model_id
      ? this._models.getModel(data.model_id)
      : this._models.selectedModel();
    return resolveServedModel(data, model ?? this._models.selectedModel());
  });

  // Effective auto-delete for THIS conversation: the per-conversation override,
  // else the account default (0 → never/off, 7, 30).
  private readonly _effectiveRetentionDays = computed(() =>
    effectiveRetentionDays(
      this.conversationService.conversation()?.record.retention_days,
      this._authService.defaultRetentionDays(),
    ),
  );

  // Fully translated, conversation-specific copy for the unified privacy panel.
  // Recomputes on language change (reads the active lang) and when the served
  // model / retention change.
  readonly privacyContent = computed(() => {
    this._language.current(); // recompute translated copy on language switch
    const served = this._servedModel();
    if (!served) {
      return undefined;
    }
    return buildPrivacyPanelContent({
      served,
      effectiveRetentionDays: this._effectiveRetentionDays(),
      securityUrl: environment.marketingBaseUrl + '/security',
      subprocessorsUrl: environment.marketingBaseUrl + '/subprocessors',
      t: (key, params) => this._transloco.translate(key, params),
    });
  });

  // Whether the active conversation has any decrypted redaction mappings. Reads
  // revision() so it recomputes when mappings finish loading.
  private readonly _hasRedactions = computed(() => {
    this._redaction.revision();
    return this._redaction.entriesFor(this._conversationId() ?? undefined).size > 0;
  });

  // Whether the user has turned personal memory off for the active chat. Read
  // from the (decrypted) conversation data, so it reflects the synced,
  // encrypted per-chat choice.
  private readonly _conversationMemoryDisabled = computed(
    () =>
      this.conversationService.conversation()?.decryptedData.memoryDisabled === true,
  );

  // The active conversation's auto-delete window, shown as the trailing label on
  // the "Auto-delete" menu entry so the current setting is visible at a glance.
  private readonly _retentionLabel = computed(() => {
    const days = normalizeConversationRetention(
      this.conversationService.conversation()?.record.retention_days,
    );
    return this._transloco.translate(
      'chat.header.autoDeleteValue.' + conversationRetentionLabelKey(days),
    );
  });

  private readonly _canClearMessages = computed(
    () =>
      this.conversationService.isTemporaryConversation() &&
      this._messageService.messages().length > 0,
  );

  // Whether the active conversation has at least one compaction — the Memory
  // control is offered only then, so short chats stay clean (spec §5.1).
  private readonly _hasCompaction = computed(() => {
    const conversationId = this._conversationId();
    return conversationId
      ? this._compaction.compactionsFor(conversationId).length > 0
      : false;
  });

  private readonly _menuEntries = computed<HeaderMenuEntry[]>(() => {
    const entries: HeaderMenuEntry[] = [];
    const hasConversation = this._conversationId() !== null;

    if (hasConversation) {
      const conversation = this.conversationService.conversation();
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
        disabled: this.exporting(),
      });

      // v1: standalone conversations only. Project chats are excluded (their
      // duplicate would need project-content-key wrapping that doesn't exist
      // yet); the action is hidden rather than shown-and-failing.
      if (!this.isProjectConversation()) {
        const conversationId = this._conversationId();
        entries.push({
          action: 'duplicate',
          title: this._transloco.translate('chat.header.duplicate'),
          icon: 'copy',
          disabled: conversationId
            ? this._duplicate.isDuplicatingSource(conversationId)
            : false,
        });
      }

      if (conversation && this._projectActions.canMoveToProject(conversation)) {
        entries.push({
          action: 'move-to-project',
          title: this._transloco.translate('chat.projectActions.moveToProject'),
          icon: 'folder',
        });
      }

      if (conversation && this._projectActions.canRemoveFromProject(conversation)) {
        entries.push({
          action: 'remove-from-project',
          title: this._transloco.translate('chat.projectActions.removeFromProject'),
          icon: 'x',
        });
      }

      // Conversation memory editor — only when an encrypted compaction exists
      // for this chat.
      if (this._hasCompaction()) {
        entries.push({
          action: 'memory',
          title: this._transloco.translate('chat.header.memory'),
          icon: 'brain',
        });
      }

      // Per-chat personal-memory switch — only meaningful once the account-wide
      // opt-in is on. Lets the user keep memory out of this one conversation.
      if (this._userPreferences.memoryEnabled()) {
        entries.push({
          action: 'toggle-conversation-memory',
          title: this._conversationMemoryDisabled()
            ? this._transloco.translate('chat.header.enableMemory')
            : this._transloco.translate('chat.header.disableMemory'),
          icon: 'brain',
        });
      }

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

      // Per-conversation auto-delete, with the current window as a trailing hint.
      entries.push({
        action: 'retention',
        title: this._transloco.translate('chat.header.autoDelete'),
        icon: 'calendar',
        trailing: this._retentionLabel(),
      });
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
        this.onExport();
        break;
      case 'duplicate':
        this.onDuplicate();
        break;
      case 'move-to-project':
        this.onMoveToProject();
        break;
      case 'remove-from-project':
        this.onRemoveFromProject();
        break;
      case 'memory':
        this.onMemory();
        break;
      case 'toggle-conversation-memory':
        this.onToggleConversationMemory();
        break;
      case 'retention':
        this.onRetention();
        break;
    }
  }

  // onRetention opens the per-conversation auto-delete dialog. Uses the shared
  // centred dialog chrome like Rename, since the flat overflow menu has no
  // submenu affordance for the four retention options.
  private onRetention() {
    const conversationId = this._conversationId();
    if (!conversationId) {
      return;
    }
    this._dialog.open(RetentionDialogComponent, {
      ...cognosDialogOptions,
      data: { conversationId },
    });
  }

  // onToggleConversationMemory flips whether personal memory is used for this
  // one conversation, independent of the account-wide opt-in. The choice rides
  // inside the encrypted conversation data, so it is persisted (and synced
  // across the owner's devices) rather than kept in browser storage.
  private onToggleConversationMemory() {
    const conversationId = this._conversationId();
    if (!conversationId) {
      return;
    }
    const disabled = !this._conversationMemoryDisabled();
    this.conversationService
      .setConversationMemoryDisabled(conversationId, disabled)
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({
        next: () => {
          this._toast.notify({
            title: disabled
              ? this._transloco.translate('chat.header.memoryDisabledToast')
              : this._transloco.translate('chat.header.memoryEnabledToast'),
          });
        },
        error: () => {
          this._toast.notify({
            title: this._transloco.translate('chat.header.memoryToggleError'),
            tone: 'danger',
          });
        },
      });
  }

  // onMemory opens the conversation-memory editor: a right-anchored drawer on
  // desktop, and a full-screen sheet that slides up from the bottom on mobile.
  private onMemory() {
    const conversationId = this._conversationId();
    if (!conversationId) {
      return;
    }
    const mobile = this._device.isMobile();
    const position = this._overlay.position().global();
    this._dialog.open(ConversationMemoryComponent, {
      backdropClass: cognosDialogOptions.backdropClass,
      panelClass: mobile
        ? ['cog-dialog-panel', 'cog-dialog-panel--sheet']
        : ['cog-dialog-panel', 'cog-dialog-panel--drawer'],
      positionStrategy: mobile
        ? position.bottom('0')
        : position.right('0').top('0').bottom('0'),
      data: { conversationId },
    });
  }

  private onDuplicate() {
    const conversation = this.conversationService.conversation();
    if (!conversation) {
      return;
    }
    // The service owns the blocking dialog, toasts, and navigation to the copy.
    void this._duplicate.duplicate(conversation);
  }

  private onMoveToProject() {
    const conversation = this.conversationService.conversation();
    if (conversation) {
      this._projectActions.openMoveDialog(conversation);
    }
  }

  private onRemoveFromProject() {
    const conversation = this.conversationService.conversation();
    if (conversation) {
      this._projectActions.removeFromProject(conversation);
    }
  }

  openSecurity() {
    this.privacyPanel.open();
  }

  closeSecurity() {
    this.privacyPanel.close();
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
    this._publicShare.existingShare(conversation).subscribe({
      next: (share) => {
        // Ignore a late response for a conversation the user already left.
        if (this._conversationId() === id) {
          this.isShared.set(share !== null);
        }
      },
      error: () => {
        if (this._conversationId() === id) {
          this.isShared.set(false);
        }
      },
    });
  }

  // Export the active conversation: decrypt its messages in the browser and
  // download them as JSON (same format as the full data export).
  private onExport() {
    const conversation = this.conversationService.conversation();
    if (!conversation || this.exporting()) {
      return;
    }

    this.exporting.set(true);
    this._export
      .downloadConversationExport(conversation, new Date())
      .then(() => {
        this._toast.notify({
          title: this._transloco.translate('chat.toasts.exported'),
        });
      })
      .catch(() => {
        this._toast.notify({
          title: this._transloco.translate('chat.toasts.exportError'),
          tone: 'danger',
        });
      })
      .finally(() => this.exporting.set(false));
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
