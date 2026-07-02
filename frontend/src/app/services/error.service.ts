import { Injectable, inject } from '@angular/core';

import { TranslocoService } from '@jsverse/transloco';

import { CognosToastService } from '@cognos/ui-angular';

@Injectable({
  providedIn: 'root',
})
export class ErrorService {
  private readonly _toastService = inject(CognosToastService);
  private readonly _transloco = inject(TranslocoService);

  // Long messages (or an explicit persist) stay up until the user dismisses
  // them, so a wordy error isn't gone before it can be read. Short messages keep
  // the usual 5s auto-dismiss.
  alert(message: string, options?: { persist?: boolean }) {
    const persist = options?.persist ?? message.length > 140;
    this._toastService.notify({
      title: this._transloco.translate('errors.somethingWentWrong'),
      msg: message,
      tone: 'danger',
      duration: persist ? 0 : 5000,
    });
  }
}
