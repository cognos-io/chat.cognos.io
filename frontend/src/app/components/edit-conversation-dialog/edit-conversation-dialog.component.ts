import { Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';

import { ConversationService } from '@app/services/conversation.service';

@Component({
  selector: 'app-edit-conversation-dialog',
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatIconModule],
  templateUrl: './edit-conversation-dialog.component.html',
  styleUrl: './edit-conversation-dialog.component.scss',
})
export class EditConversationDialogComponent {
  conversationService = inject(ConversationService);
  data: { conversationId: string } = inject(MAT_DIALOG_DATA);
}
