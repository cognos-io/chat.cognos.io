import { Dialog } from '@angular/cdk/dialog';
import { inject } from '@angular/core';
import { CanActivateFn } from '@angular/router';

import { filter, map, take, tap } from 'rxjs';

import { TranslocoService } from '@jsverse/transloco';

import { VaultPasswordDialogComponent } from '@app/components/vault-password-dialog/vault-password-dialog.component';
import { VaultService } from '@app/services/vault.service';
import { cognosDialogOptions } from '@app/utils/dialog-options';

export const keyPairRequiredGuard: CanActivateFn = () => {
  const dialog = inject(Dialog);
  const vaultService = inject(VaultService);
  const transloco = inject(TranslocoService);

  let dialogRef: { close: () => void } | undefined;

  return vaultService.keyPair$.pipe(
    filter((keyPair) => {
      if (keyPair) {
        return true;
      }

      dialogRef ??= dialog.open(VaultPasswordDialogComponent, {
        ...cognosDialogOptions(
          transloco.translate('dialogs.vaultPassword.titleUnlock'),
        ),
        disableClose: true,
      });

      return false;
    }),
    take(1),
    tap(() => dialogRef?.close()),
    map(() => true),
  );
};
