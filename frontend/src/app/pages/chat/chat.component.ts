import {
  Component,
  OnDestroy,
  computed,
  effect,
  inject,
  viewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatMenuModule } from '@angular/material/menu';
import { MatSidenav, MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterModule } from '@angular/router';

import { Subject, takeUntil } from 'rxjs';

import { CognosLogoComponent } from '@app/components/cognos-logo/cognos-logo.component';
import { ConfirmationDialogComponent } from '@app/components/confirmation-dialog/confirmation-dialog.component';
import { ContactHelpDialogComponent } from '@app/components/contact-help-dialog/contact-help-dialog.component';
import { EditConversationDialogComponent } from '@app/components/edit-conversation-dialog/edit-conversation-dialog.component';
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
    MatMenuModule,
    CognosLogoComponent,
  ],
  templateUrl: './chat.component.html',
  styleUrl: './chat.component.scss',
})
export class ChatComponent implements OnDestroy {
  private readonly _destroyed$ = new Subject<void>();

  private readonly dialog = inject(MatDialog);
  private readonly _sideNav = viewChild<MatSidenav>('sideNav');
  private readonly _deviceService = inject(DeviceService);
  private readonly _conversationService = inject(ConversationService);
  private readonly _messageService = inject(MessageService);

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

  ngOnDestroy(): void {
    this._destroyed$.next();
    this._destroyed$.complete();
  }

  onOpenHelpDialog() {
    this.dialog.open(ContactHelpDialogComponent);
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

  onRenameConversation(conversationId: string) {
    this.dialog.open(EditConversationDialogComponent, {
      data: {
        conversationId,
      },
    });
  }

  onDeleteConversation(conversationId: string) {
    this.dialog
      .open(ConfirmationDialogComponent, {
        data: {
          message: 'Are you sure you want to delete this conversation?',
        },
      })
      .afterClosed()
      .pipe(takeUntil(this._destroyed$))
      .subscribe((result: boolean) => {
        if (result) {
          this.conversationService.deleteConversation$.next(conversationId);
          this.router.navigate(['/']);
        }
      });
  }

  onPinConversation(conversationId: string) {
    console.log('pinning conversation', conversationId);
  }

  onClearMessages() {
    this._messageService.resetState();
  }
}
