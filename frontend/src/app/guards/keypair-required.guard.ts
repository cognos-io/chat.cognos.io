import { inject } from '@angular/core';
import { MatDialog, MatDialogRef } from '@angular/material/dialog';
import { CanActivateChildFn } from '@angular/router';

import { of, switchMap } from 'rxjs';

import { VaultPasswordDialogComponent } from '@app/components/vault-password-dialog/vault-password-dialog.component';
import { VaultService } from '@app/services/vault.service';

export const keyPairRequiredGuard: CanActivateChildFn = () => {
  const vaultService = inject(VaultService);
  const dialog = inject(MatDialog);

  let dialogRef: MatDialogRef<VaultPasswordDialogComponent> | undefined;

  return vaultService.keyPair$.pipe(
    switchMap((keyPair) => {
      if (keyPair) {
        dialogRef?.close();
        return of(true);
      }

      // show the vault password dialog if we don't have a key pair
      dialogRef = dialog.open(VaultPasswordDialogComponent, {
        disableClose: true,
      });

      return dialogRef.afterClosed();
    }),
  );
};
