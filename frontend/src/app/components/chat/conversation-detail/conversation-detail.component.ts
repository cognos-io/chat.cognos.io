import { CommonModule } from '@angular/common';
import { Component, Input, computed, inject, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { LoadingIndicatorComponent } from '@app/components/loading-indicator/loading-indicator.component';
import { ConversationService } from '@app/services/conversation.service';
import { MessageService, MessageStatus } from '@app/services/message.service';

import { MessageFormComponent } from '../message-form/message-form.component';
import { MessageListComponent } from '../message-list/message-list.component';

@Component({
  selector: 'app-conversation-detail',
  standalone: true,
  imports: [
    CommonModule,
    MessageFormComponent,
    MessageListComponent,
    LoadingIndicatorComponent,
  ],
  template: `<div class="conversation-container w-full">
    @if (isFetching()) {
      <app-loading-indicator></app-loading-indicator>
    } @else {
      <app-message-list
        class="message-container"
        [messages]="(messageService.messages$ | async) ?? []"
      ></app-message-list>
      <app-message-form></app-message-form>
    }
  </div>`,
  styles: `
    .conversation-container {
      display: flex;
      flex-direction: column;

      padding: var(--chat-container-padding);

      height: 100%;
    }

    .message-container {
      // needed for scrolling
      height: 0px;
      min-height: 100px;

      flex-grow: 1;
      overflow-y: auto;
      overflow-x: hidden;
    }
  `,
})
export class ConversationDetailComponent {
  private readonly _conversationService = inject(ConversationService);
  private readonly _messageListEl = viewChild(MessageListComponent);

  readonly messageService = inject(MessageService);
  readonly isFetching = computed(
    () => this.messageService.status() === MessageStatus.Fetching,
  );

  @Input()
  set conversationId(conversationId: string) {
    this._conversationService.selectConversation$.next(conversationId ?? '');
  }

  constructor() {
    this.messageService.messages$.pipe(takeUntilDestroyed()).subscribe(() => {
      this._messageListEl()?.scrollToBottom();
    });
  }
}
