import { Component, inject } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';

import { map } from 'rxjs';

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
  private readonly route = inject(ActivatedRoute);
  private readonly conversationService = inject(ConversationService);

  constructor() {
    this.route.paramMap
      .pipe(
        map((params) => {
          const conversationId = params.get('conversationId');
          if (!conversationId) {
            return;
          }
          this.conversationService.selectConversation$.next(conversationId);
        }),
      )
      .pipe(takeUntilDestroyed())
      .subscribe();
  }
}
