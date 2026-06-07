import { Dialog } from '@angular/cdk/dialog';
import { inject } from '@angular/core';
import { CanActivateFn } from '@angular/router';

import { filter, map, take, tap } from 'rxjs';

import { VaultPasswordDialogComponent } from '@app/components/vault-password-dialog/vault-password-dialog.component';
import { VaultService } from '@app/services/vault.service';
import { cognosDialogOptions } from '@app/utils/dialog-options';

export const keyPairRequiredGuard: CanActivateFn = () => {
  const dialog = inject(Dialog);
  const vaultService = inject(VaultService);

  let dialogRef: { close: () => void } | undefined;

  return vaultService.keyPair$.pipe(
    filter((keyPair) => {
      if (keyPair) {
        return true;
      }

      dialogRef ??= dialog.open(VaultPasswordDialogComponent, {
        ...cognosDialogOptions,
        disableClose: true,
      });

      return false;
    }),
    take(1),
    tap(() => dialogRef?.close()),
    map(() => true),
  );
};
