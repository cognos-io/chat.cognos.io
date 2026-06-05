import { Injectable, inject } from '@angular/core';

import { CognosToastService } from '@cognos/ui-angular';

@Injectable({
  providedIn: 'root',
})
export class ErrorService {
  private readonly _toastService = inject(CognosToastService);

  alert(message: string) {
    this._toastService.notify({
      title: 'Something went wrong',
      msg: message,
      tone: 'danger',
      duration: 5000,
    });
  }
}
