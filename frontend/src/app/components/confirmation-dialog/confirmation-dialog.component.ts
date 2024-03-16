import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';

@Component({
  selector: 'app-confirmation-dialog',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatIconModule],
  templateUrl: './confirmation-dialog.component.html',
  styleUrl: './confirmation-dialog.component.scss',
})
export class ConfirmationDialogComponent {
  data: { message: string } = inject(MAT_DIALOG_DATA);
}
