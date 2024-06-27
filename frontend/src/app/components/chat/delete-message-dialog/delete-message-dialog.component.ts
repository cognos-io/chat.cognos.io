import { ChangeDetectionStrategy, Component } from '@angular/core';

@Component({
  selector: 'app-delete-message-dialog',
  standalone: true,
  imports: [],
  template: ` <p>delete-message-dialog works!</p> `,
  styles: ``,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DeleteMessageDialogComponent {}
