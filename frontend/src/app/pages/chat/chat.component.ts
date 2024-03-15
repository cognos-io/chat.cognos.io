import { Component, effect, inject, signal } from '@angular/core';
import { MatListModule } from '@angular/material/list';
import { MatSidenavModule } from '@angular/material/sidenav';
import { MatIconModule } from '@angular/material/icon';
import { MatButtonModule } from '@angular/material/button';
import { MatToolbarModule } from '@angular/material/toolbar';
import { BreakpointObserver, Breakpoints } from '@angular/cdk/layout';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ConversationService } from '../../services/conversation.service';
import { VaultService } from '../../services/vault.service';
import {
  MatDialog,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';
import { VaultPasswordDialogComponent } from '../../components/vault-password-dialog/vault-password-dialog.component';

@Component({
  selector: 'app-chat',
  standalone: true,
  imports: [
    MatDialogModule,
    MatToolbarModule,
    MatButtonModule,
    MatIconModule,
    MatSidenavModule,
    MatListModule,
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
        backdropClass: 'backdrop-blur',
        height: '400px',
        width: '600px',
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
}
