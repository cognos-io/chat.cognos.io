import { CommonModule } from '@angular/common';
import { Component, Input, inject } from '@angular/core';

import { ConversationService } from '@app/services/conversation.service';
import { MessageService } from '@app/services/message.service';

import { MessageFormComponent } from '../message-form/message-form.component';
import { MessageListComponent } from '../message-list/message-list.component';

@Component({
  selector: 'app-conversation-detail',
  standalone: true,
  imports: [CommonModule, MessageFormComponent, MessageListComponent],
  templateUrl: './conversation-detail.component.html',
  styleUrl: './conversation-detail.component.scss',
})
export class ConversationDetailComponent {
  private readonly _conversationService = inject(ConversationService);

  readonly messageService = inject(MessageService);

  @Input()
  set conversationId(conversationId: string) {
    this._conversationService.selectConversation$.next(conversationId ?? '');
  }
}
