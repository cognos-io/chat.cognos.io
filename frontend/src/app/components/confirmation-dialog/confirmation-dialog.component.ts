import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { DialogRef, DIALOG_DATA } from '@angular/cdk/dialog';

import { CognosButtonComponent, CognosDialogSurfaceComponent } from '@cognos/ui-angular';

@Component({
  selector: 'app-confirmation-dialog',
  standalone: true,
  imports: [CognosDialogSurfaceComponent, CognosButtonComponent],
  template: `
    <cog-dialog-surface title="Just checking" [footer]="true" (close)="close()">
      <p class="confirmation-dialog__message">{{ data.message }}</p>

      <div cogDialogFooter>
        <cog-button appearance="subtle" (click)="close()">No</cog-button>
        <cog-button appearance="danger" (click)="confirm()">Yes</cog-button>
      </div>
    </cog-dialog-surface>
  `,
  styles: `
    .confirmation-dialog__message {
      margin: 0;
      color: var(--cog-text);
      font-size: var(--cog-fs-body);
      line-height: var(--cog-lh-body);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ConfirmationDialogComponent {
  private readonly _dialogRef = inject(DialogRef<boolean>);

  readonly data: { message: string } = inject(DIALOG_DATA);

  close() {
    this._dialogRef.close(false);
  }

  confirm() {
    this._dialogRef.close(true);
  }
}
