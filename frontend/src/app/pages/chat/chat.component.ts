import { Dialog, DialogRef } from '@angular/cdk/dialog';
import { CommonModule } from '@angular/common';
import { Component, computed, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { NavigationEnd, Router, RouterModule } from '@angular/router';

import { filter } from 'rxjs';

import {
  CognosButtonComponent,
  CognosDrawerComponent,
  CognosIconButtonComponent,
  CognosIconComponent,
  CognosLozengeComponent,
  CognosTextFieldComponent,
  CognosToastService,
} from '@cognos/ui-angular';

import { ChatHeaderComponent } from '@app/components/chat/chat-header/chat-header.component';
import { ConversationListItemComponent } from '@app/components/chat/conversation-list/conversation-list-item/conversation-list-item.component';
import { CognosLogoComponent } from '@app/components/cognos-logo/cognos-logo.component';
import { ContactHelpDialogComponent } from '@app/components/contact-help-dialog/contact-help-dialog.component';
import { LoadingIndicatorComponent } from '@app/components/loading-indicator/loading-indicator.component';
import { VaultPasswordDialogComponent } from '@app/components/vault-password-dialog/vault-password-dialog.component';
import { MessageService } from '@app/services/message.service';
import { VaultService } from '@app/services/vault.service';
import { cognosDialogOptions } from '@app/utils/dialog-options';

import { ConversationService } from '../../services/conversation.service';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    CognosButtonComponent,
    CognosDrawerComponent,
    CognosIconButtonComponent,
    CognosIconComponent,
    CognosLozengeComponent,
    CognosLogoComponent,
    CognosTextFieldComponent,
    ChatHeaderComponent,
    ConversationListItemComponent,
    LoadingIndicatorComponent,
  ],
  templateUrl: './chat.component.html',
  styleUrl: './chat.component.scss',
})
export class ChatComponent {
  private readonly _dialog = inject(Dialog);
  private readonly _messageService = inject(MessageService);
  private readonly _toastService = inject(CognosToastService);
  private readonly _vaultService = inject(VaultService);

  readonly router = inject(Router);
  readonly conversationService = inject(ConversationService);
  readonly drawerOpen = signal(false);

  private _vaultDialogRef: DialogRef<unknown, VaultPasswordDialogComponent> | null =
    null;

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
      });

    // Hold the unlock dialog until the persistent-session restore settles, so
    // returning users with a valid trusted-device session never see a flash of
    // the unlock form between page load and keyPair becoming available.
    effect(() => {
      const keyPair = this._vaultService.keyPair();
      const restoring = this._vaultService.isRestoring();

      if (keyPair) {
        this._vaultDialogRef?.close();
        this._vaultDialogRef = null;
        return;
      }

      if (restoring) {
        return;
      }

      this._vaultDialogRef ??= this._dialog.open(VaultPasswordDialogComponent, {
        ...cognosDialogOptions,
        disableClose: true,
      });
    });
  }

  onOpenHelpDialog() {
    this._dialog.open(ContactHelpDialogComponent, cognosDialogOptions);
  }

  onNewConversation() {
    if (this.canClearTemporaryMessages()) {
      this._messageService.resetState();
    }

    this.drawerOpen.set(false);

    if (this.router.url !== '/') {
      this.router.navigateByUrl('/');
    }
  }

  onLock() {
    this.drawerOpen.set(false);
    this._vaultService.lock();
    this._toastService.notify({
      title: 'Account locked',
      msg: 'This device now needs your password and Account Key to unlock again.',
      tone: 'info',
      icon: 'lock',
      duration: 4200,
    });
  }

  onLogout() {
    this.drawerOpen.set(false);
    this.router.navigate(['', 'auth', 'logout']);
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
