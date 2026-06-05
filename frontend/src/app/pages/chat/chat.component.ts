import { CommonModule } from '@angular/common';
import { Component, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { Dialog } from '@angular/cdk/dialog';
import { NavigationEnd, Router, RouterModule } from '@angular/router';

import { filter } from 'rxjs';

import {
  CognosBreadcrumbItem,
  CognosBreadcrumbsComponent,
  CognosButtonComponent,
  CognosDrawerComponent,
  CognosIconButtonComponent,
  CognosIconComponent,
  CognosLozengeComponent,
  CognosTextFieldComponent,
} from '@cognos/ui-angular';

import { ConversationListItemComponent } from '@app/components/chat/conversation-list/conversation-list-item/conversation-list-item.component';
import { CognosLogoComponent } from '@app/components/cognos-logo/cognos-logo.component';
import { ContactHelpDialogComponent } from '@app/components/contact-help-dialog/contact-help-dialog.component';
import { DeviceService } from '@app/services/device.service';
import { MessageService } from '@app/services/message.service';
import { cognosDialogOptions } from '@app/utils/dialog-options';

import { ConversationService } from '../../services/conversation.service';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [
    CommonModule,
    RouterModule,
    CognosBreadcrumbsComponent,
    CognosButtonComponent,
    CognosDrawerComponent,
    CognosIconButtonComponent,
    CognosIconComponent,
    CognosLozengeComponent,
    CognosLogoComponent,
    CognosTextFieldComponent,
    ConversationListItemComponent,
  ],
  templateUrl: './chat.component.html',
  styleUrl: './chat.component.scss',
})
export class ChatComponent {
  private readonly _deviceService = inject(DeviceService);
  private readonly _dialog = inject(Dialog);
  private readonly _messageService = inject(MessageService);

  readonly router = inject(Router);
  readonly conversationService = inject(ConversationService);
  readonly drawerOpen = signal(false);

  readonly isMobile = computed(() => this._deviceService.isMobile());

  readonly pageTitle = computed(() => {
    const title = this.conversationService.conversation()?.decryptedData.title;

    if (title) {
      return title;
    }

    return this.conversationService.isTemporaryConversation()
      ? 'Temporary chat'
      : 'New chat';
  });

  readonly breadcrumbs = computed<CognosBreadcrumbItem[]>(() => {
    const pageTitle = this.pageTitle();

    if (pageTitle === 'New chat') {
      return [{ label: 'Cognos', current: true }];
    }

    return [{ label: 'Cognos' }, { label: pageTitle, current: true }];
  });

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
  }

  onBreadcrumbSelect(index: number) {
    if (index === 0) {
      this.onNewConversation();
    }
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

  onClearMessages() {
    this._messageService.resetState();
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
