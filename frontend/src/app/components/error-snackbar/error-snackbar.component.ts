import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import {
  MAT_SNACK_BAR_DATA,
  MatSnackBarAction,
  MatSnackBarActions,
  MatSnackBarLabel,
  MatSnackBarRef,
} from '@angular/material/snack-bar';

@Component({
  selector: 'app-error-snackbar',
  standalone: true,
  imports: [MatButtonModule, MatSnackBarLabel, MatSnackBarActions, MatSnackBarAction],
  template: `<span matSnackBarLabel class="error"> {{ snackBarData }} </span>
    <span matSnackBarActions>
      <button
        class="error-button"
        mat-button
        matSnackBarAction
        (click)="snackBarRef.dismissWithAction()"
        color="accent"
      >
        Close
      </button>
    </span> `,
  styles: `
    :host {
      display: flex;
    }

    .error-button {
      background-color: var(--error-text-color);
      --mat-snack-bar-button-color: var(--error-bg-color);
    }
  `,
})
export class ErrorSnackbarComponent {
  snackBarRef = inject(MatSnackBarRef);
  snackBarData = inject(MAT_SNACK_BAR_DATA);
}
