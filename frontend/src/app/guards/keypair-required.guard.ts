import { inject } from '@angular/core';
import { CanActivateChildFn } from '@angular/router';
import { Dialog, DialogRef } from '@angular/cdk/dialog';

import { map, of, switchMap } from 'rxjs';

import { VaultPasswordDialogComponent } from '@app/components/vault-password-dialog/vault-password-dialog.component';
import { VaultService } from '@app/services/vault.service';
import { cognosDialogOptions } from '@app/utils/dialog-options';

export const keyPairRequiredGuard: CanActivateChildFn = () => {
  const vaultService = inject(VaultService);
  const dialog = inject(Dialog);

  let dialogRef: DialogRef<unknown, VaultPasswordDialogComponent> | null = null;

  return vaultService.keyPair$.pipe(
    switchMap((keyPair) => {
      if (keyPair) {
        dialogRef?.close();
        return of(true);
      }

      dialogRef ??= dialog.open(VaultPasswordDialogComponent, {
        ...cognosDialogOptions,
        disableClose: true,
      });

      return dialogRef.closed.pipe(map((result) => Boolean(result)));
    }),
  );
};
