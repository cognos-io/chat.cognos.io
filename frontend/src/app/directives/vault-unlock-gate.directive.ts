import { Dialog, DialogRef } from '@angular/cdk/dialog';
import { DestroyRef, Directive, effect, inject } from '@angular/core';

import { TranslocoService } from '@jsverse/transloco';

import { VaultPasswordDialogComponent } from '@app/components/vault-password-dialog/vault-password-dialog.component';
import { VaultService } from '@app/services/vault.service';
import { cognosDialogOptions } from '@app/utils/dialog-options';

/**
 * VaultUnlockGateDirective prompts for the Account Key whenever the host is
 * mounted and the vault is locked, and dismisses the prompt once it unlocks.
 *
 * It is applied (via `hostDirectives`) to the authenticated shells — the chat
 * shell and the settings shell — rather than the app root, so the unlock
 * prompt covers every vault-backed surface (chats, projects, …) without ever
 * appearing on the login, register, or public-share pages, which don't mount a
 * shell and don't need the vault.
 *
 * The restore guard waits out the trusted-device session restore so returning
 * users never see a flash of the unlock form before their keypair loads.
 */
@Directive({
  selector: '[appVaultUnlockGate]',
  standalone: true,
})
export class VaultUnlockGateDirective {
  private readonly _dialog = inject(Dialog);
  private readonly _vault = inject(VaultService);
  private readonly _transloco = inject(TranslocoService);
  private _dialogRef: DialogRef<unknown, VaultPasswordDialogComponent> | null = null;

  constructor() {
    effect(() => {
      const keyPair = this._vault.keyPair();
      const restoring = this._vault.isRestoring();

      if (keyPair) {
        this._dialogRef?.close();
        this._dialogRef = null;
        return;
      }

      if (restoring) {
        return;
      }

      if (!this._dialogRef) {
        // Quantifies the Account-Key re-entry pain; the service dedupes per
        // locked period (shell handovers re-open the same prompt).
        this._vault.notifyUnlockPrompted();
        this._dialogRef = this._dialog.open(VaultPasswordDialogComponent, {
          ...cognosDialogOptions(
            this._transloco.translate('dialogs.vaultPassword.titleUnlock'),
          ),
          disableClose: true,
        });
      }
    });

    // Closing on destroy hands the prompt over cleanly when navigating between
    // shells (e.g. chat → settings); the destination shell re-opens it if the
    // vault is still locked.
    inject(DestroyRef).onDestroy(() => {
      this._dialogRef?.close();
      this._dialogRef = null;
    });
  }
}
