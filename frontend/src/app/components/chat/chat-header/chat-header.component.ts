import { Dialog } from '@angular/cdk/dialog';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  HostListener,
  computed,
  inject,
  signal,
} from '@angular/core';
import { Router } from '@angular/router';

import { Base64 } from 'js-base64';

import {
  CognosAvatarComponent,
  type CognosBreadcrumbItem,
  CognosBreadcrumbsComponent,
  CognosButtonComponent,
  CognosIconButtonComponent,
  CognosMenuComponent,
  type CognosMenuItem,
  CognosSecurityModalComponent,
} from '@cognos/ui-angular';

import { ConfirmationDialogComponent } from '@app/components/confirmation-dialog/confirmation-dialog.component';
import { EditConversationDialogComponent } from '@app/components/edit-conversation-dialog/edit-conversation-dialog.component';
import { ShareConversationDialogComponent } from '@app/components/share-conversation-dialog/share-conversation-dialog.component';
import { AuthService } from '@app/services/auth.service';
import { ConversationService } from '@app/services/conversation.service';
import { DeviceService } from '@app/services/device.service';
import { MessageService } from '@app/services/message.service';
import { VaultService } from '@app/services/vault.service';
import { cognosDialogOptions } from '@app/utils/dialog-options';

type HeaderMenuAction = 'share' | 'rename' | 'export' | 'clear' | 'delete';

type HeaderMenuEntry = CognosMenuItem & { action: HeaderMenuAction };

@Component({
  selector: 'app-chat-header',
  standalone: true,
  imports: [
    CognosAvatarComponent,
    CognosBreadcrumbsComponent,
    CognosButtonComponent,
    CognosIconButtonComponent,
    CognosMenuComponent,
    CognosSecurityModalComponent,
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

  readonly conversationService = inject(ConversationService);

  readonly menuOpen = signal(false);
  readonly securityOpen = signal(false);

  // Sharing is only meaningful for a persisted conversation; temporary chats
  // have nothing the server can hand to a public reader.
  readonly canShare = computed(() => this._conversationId() !== null);

  readonly title = computed(() => {
    const title = this.conversationService.conversation()?.decryptedData.title;

    if (title) {
      return title;
    }

    return this.conversationService.isTemporaryConversation()
      ? 'Temporary chat'
      : 'New chat';
  });

  // Breadcrumbs only render when a conversation lives inside a project. Projects
  // do not exist yet, so this stays empty until that feature lands.
  readonly breadcrumbs = computed<CognosBreadcrumbItem[]>(() => []);

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
        entries.push({ action: 'share', title: 'Share', icon: 'user-plus' });
      }
      entries.push({ action: 'rename', title: 'Rename', icon: 'pencil' });
      entries.push({
        action: 'export',
        title: 'Export',
        icon: 'download',
        disabled: true,
        trailing: 'Soon',
      });
    }

    if (this._canClearMessages()) {
      entries.push({ action: 'clear', title: 'Clear messages', icon: 'eraser' });
    }

    if (hasConversation) {
      entries.push({ action: 'delete', title: 'Delete', icon: 'x' });
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

    if (!conversationId) {
      return;
    }

    this._dialog.open(ShareConversationDialogComponent, {
      ...cognosDialogOptions,
      data: { conversationId },
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
          message: 'Are you sure you want to delete this conversation?',
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
