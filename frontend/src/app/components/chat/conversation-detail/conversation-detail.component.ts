import { Component, Input, inject } from '@angular/core';

import { ConversationService } from '@app/services/conversation.service';

import { MessageFormComponent } from '../message-form/message-form.component';
import { MessageListComponent } from '../message-list/message-list.component';

@Component({
  selector: 'app-conversation-detail',
  standalone: true,
  imports: [MessageFormComponent, MessageListComponent],
  templateUrl: './conversation-detail.component.html',
  styleUrl: './conversation-detail.component.scss',
})
export class ConversationDetailComponent {
  private readonly _conversationService = inject(ConversationService);

  @Input()
  set conversationId(conversationId: string) {
    this._conversationService.selectConversation$.next(conversationId ?? '');
  }
}
