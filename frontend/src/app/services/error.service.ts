import { Injectable, inject } from '@angular/core';
import { MatSnackBar } from '@angular/material/snack-bar';

import { ErrorSnackbarComponent } from '@app/components/error-snackbar/error-snackbar.component';

const showDurationMs = 5 * 1000; // 5 seconds

@Injectable({
  providedIn: 'root',
})
export class ErrorService {
  private readonly _snackBar = inject(MatSnackBar);

  alert(message: string) {
    this._snackBar.openFromComponent(ErrorSnackbarComponent, {
      panelClass: 'error-snackbar',
      duration: showDurationMs,
      data: message,
    });
  }
}
