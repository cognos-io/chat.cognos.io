import { Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterModule } from '@angular/router';

import { ConversationListItemComponent } from '@app/components/chat/conversation-list/conversation-list-item/conversation-list-item.component';
import { CognosLogoComponent } from '@app/components/cognos-logo/cognos-logo.component';
import { ContactHelpDialogComponent } from '@app/components/contact-help-dialog/contact-help-dialog.component';
import { DeviceService } from '@app/services/device.service';
import { MessageService } from '@app/services/message.service';

import { ConversationService } from '../../services/conversation.service';
import { VaultService } from '../../services/vault.service';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [
    RouterModule,
    MatDialogModule,
    MatToolbarModule,
    MatButtonModule,
    MatIconModule,
    MatSidenavModule,
    MatListModule,
    MatTooltipModule,
    MatExpansionModule,
    CognosLogoComponent,
    ConversationListItemComponent,
  ],
  templateUrl: './chat.component.html',
  styleUrl: './chat.component.scss',
})
export class ChatComponent {
  private readonly _deviceService = inject(DeviceService);
  private readonly _conversationService = inject(ConversationService);
  private readonly _messageService = inject(MessageService);
  private readonly _dialog = inject(MatDialog);

  readonly router = inject(Router);
  readonly conversationService = inject(ConversationService);
  readonly vaultService = inject(VaultService);

  readonly isMobile = computed(() => this._deviceService.isMobile());

  canClearTemporaryMessages = computed(() => {
    return (
      this._conversationService.isTemporaryConversation() &&
      this._messageService.messages().length > 0
    );
  });

  onOpenHelpDialog() {
    this._dialog.open(ContactHelpDialogComponent);
  }

  onNewConversation() {
    if (this.canClearTemporaryMessages()) {
      this._messageService.resetState();
    }
    // don't navigate if we're already on the new conversation page
    if (this.router.url !== '/') {
      this.router.navigateByUrl('/');
    }
  }

  onClearMessages() {
    this._messageService.resetState();
  }
}
