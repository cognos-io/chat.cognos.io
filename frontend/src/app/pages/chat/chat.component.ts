import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { Component, effect, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatMenuModule } from '@angular/material/menu';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterModule } from '@angular/router';

import { EditConversationDialogComponent } from '@app/components/edit-conversation-dialog/edit-conversation-dialog.component';

import { VaultPasswordDialogComponent } from '../../components/vault-password-dialog/vault-password-dialog.component';
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
  ],
  templateUrl: './chat.component.html',
  styleUrl: './chat.component.scss',
})
export class ChatComponent {
  private readonly breakpointObserver = inject(BreakpointObserver);
  private readonly dialog = inject(MatDialog);

  // show the vault password dialog if we don't have a key pair
  private dialogRef: MatDialogRef<VaultPasswordDialogComponent> | undefined;
  private readonly vaultUnlockEffect = effect(() => {
    if (!this.vaultService.keyPair()) {
      this.dialogRef = this.dialog.open(VaultPasswordDialogComponent, {
        disableClose: true,
      });
    } else {
      this.dialogRef?.close();
    }
  });

  readonly conversationService = inject(ConversationService);
  readonly vaultService = inject(VaultService);

  isMobile = signal(false);

  constructor() {
    this.breakpointObserver
      .observe([Breakpoints.Handset])
      .pipe(takeUntilDestroyed())
      .subscribe((result) => this.isMobile.set(result.matches));
  }

  onEditConversation(conversationId: string) {
    this.dialog.open(EditConversationDialogComponent, {
      data: {
        conversationId,
      },
    });
  }
}
