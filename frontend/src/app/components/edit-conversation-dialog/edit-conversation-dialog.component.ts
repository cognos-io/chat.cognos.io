import { Component, OnInit, inject } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';

import { ConversationService } from '@app/services/conversation.service';

@Component({
  selector: 'app-edit-conversation-dialog',
  standalone: true,
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatInputModule,
    MatFormFieldModule,
    ReactiveFormsModule,
  ],
  template: `<h2 mat-dialog-title="">Edit conversation</h2>
    <mat-dialog-content>
      <p>Enter the new name for your conversation</p>
      <form action="" (submit)="onEditConversation()">
        <mat-form-field class="w-full"
          ><input type="text" matInput="" [formControl]="title"
        /></mat-form-field>
      </form>
      <mat-dialog-actions align="end">
        <button mat-button="" mat-dialog-close="" color="secondary">Cancel</button>
        <button mat-button="" mat-dialog-close="" color="primary">Save</button>
      </mat-dialog-actions>
    </mat-dialog-content> `,
  styles: ``,
})
export class EditConversationDialogComponent implements OnInit {
  conversationService = inject(ConversationService);
  data: { conversationId: string } = inject(MAT_DIALOG_DATA);

  title = new FormControl('');

  onEditConversation() {}

  ngOnInit(): void {
    const conversation = this.conversationService.getConversation(
      this.data.conversationId,
    )();

    if (conversation) {
      this.title.setValue(conversation.decryptedData.title);
    }
  }
}
