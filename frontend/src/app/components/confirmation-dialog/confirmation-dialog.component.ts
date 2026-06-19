import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, inject } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';

import {
  CognosButtonComponent,
  CognosDialogSurfaceComponent,
} from '@cognos/ui-angular';

@Component({
  selector: 'app-confirmation-dialog',
  standalone: true,
  imports: [CognosDialogSurfaceComponent, CognosButtonComponent, TranslocoModule],
  template: `
    <cog-dialog-surface
      *transloco="let t"
      [title]="t('dialogs.confirm.title')"
      [footer]="true"
      (close)="close()"
    >
      <p class="confirmation-dialog__message">{{ data.message }}</p>

      <div cogDialogFooter>
        <cog-button appearance="subtle" (click)="close()">{{
          t('dialogs.confirm.no')
        }}</cog-button>
        <cog-button appearance="danger" (click)="confirm()">{{
          t('dialogs.confirm.yes')
        }}</cog-button>
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
