import { ChangeDetectionStrategy, Component } from '@angular/core';
import { MatDialogContent, MatDialogTitle } from '@angular/material/dialog';

@Component({
  selector: 'app-contact-help-dialog',
  standalone: true,
  imports: [MatDialogTitle, MatDialogContent],
  template: `<h2 mat-dialog-title>Need help? Want to contact me?</h2>
    <mat-dialog-content>
      <p>So you want to contact me?</p>
    </mat-dialog-content>`,
  styles: ``,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ContactHelpDialogComponent {}
