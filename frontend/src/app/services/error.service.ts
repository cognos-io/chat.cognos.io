import { Injectable, inject } from '@angular/core';

import { TranslocoService } from '@jsverse/transloco';

import { CognosToastService } from '@cognos/ui-angular';

@Injectable({
  providedIn: 'root',
})
export class ErrorService {
  private readonly _toastService = inject(CognosToastService);
  private readonly _transloco = inject(TranslocoService);

  alert(message: string) {
    this._toastService.notify({
      title: this._transloco.translate('errors.somethingWentWrong'),
      msg: message,
      tone: 'danger',
      duration: 5000,
    });
  }
}
