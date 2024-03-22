import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { Component, OnDestroy, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatIconModule } from '@angular/material/icon';
import { MatListModule } from '@angular/material/list';
import { MatMenuModule } from '@angular/material/menu';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterModule } from '@angular/router';

import { Subject, takeUntil } from 'rxjs';

import { ConfirmationDialogComponent } from '@app/components/confirmation-dialog/confirmation-dialog.component';
import { EditConversationDialogComponent } from '@app/components/edit-conversation-dialog/edit-conversation-dialog.component';

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
export class ChatComponent implements OnDestroy {
  private readonly _destroyed$ = new Subject<void>();

  private readonly breakpointObserver = inject(BreakpointObserver);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);

  readonly conversationService = inject(ConversationService);
  readonly vaultService = inject(VaultService);

  isMobile = signal(false);

  constructor() {
    this.breakpointObserver
      .observe([Breakpoints.Handset])
      .pipe(takeUntilDestroyed())
      .subscribe((result) => this.isMobile.set(result.matches));
  }

  ngOnDestroy(): void {
    this._destroyed$.next();
    this._destroyed$.complete();
  }

  onEditConversation(conversationId: string) {
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
}
