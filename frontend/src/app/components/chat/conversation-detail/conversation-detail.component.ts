import { CommonModule } from '@angular/common';
import { Component, Input, computed, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';

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
    MatButtonModule,
    MatIconModule,
  ],
  template: `<div class="conversation-container w-full">
    @if (isFetching()) {
      <app-loading-indicator></app-loading-indicator>
    } @else {
      <div class="relative flex h-full flex-col">
        <app-message-list
          class="message-container"
          [messages]="(messages | async) ?? []"
          [messageSending]="isSending()"
          [loadingMessages]="isLoadingMoreMessages()"
          (nextPage)="messageService.nextPage()"
          (atBottom)="messagesAtBottom.set($event)"
        ></app-message-list>

        @if (!messagesAtBottom() && ((messages | async) ?? []).length !== 0) {
          <button
            mat-mini-fab
            color="tertiary"
            aria-label="Scroll to bottom of conversation"
            (click)="messageListEl()?.scrollToBottom()"
            class="absolute bottom-8 right-8"
          >
            <mat-icon fontSet="bi" fontIcon="bi-arrow-down"></mat-icon>
          </button>
        }
      </div>
      <div class="mx-auto w-full max-w-[80ch] pt-2">
        <app-message-form></app-message-form>
      </div>
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
    }

    button[mat-mini-fab].absolute {
      position: absolute;
    }
  `,
})
export class ConversationDetailComponent {
  private readonly _conversationService = inject(ConversationService);

  readonly messageListEl = viewChild(MessageListComponent);

  readonly messageService = inject(MessageService);
  readonly isFetching = computed(
    () => this.messageService.status() === MessageStatus.Fetching,
  );
  readonly isSending = computed(
    () => this.messageService.status() === MessageStatus.Sending,
  );
  readonly isLoadingMoreMessages = computed(
    () => this.messageService.status() === MessageStatus.LoadingMoreMessages,
  );

  readonly messagesAtBottom = signal(false);

  @Input()
  set conversationId(conversationId: string) {
    this._conversationService.selectConversation$.next(conversationId ?? '');
  }

  get messages() {
    return this.messageService.messages$;
  }

  constructor() {
    // Scroll to bottom when messages changes if the user is already at the bottom (so not if they have scrolled up)
    this.messageService.messages$.pipe(takeUntilDestroyed()).subscribe(() => {
      if (this.messagesAtBottom()) {
        setTimeout(() => this.messageListEl()?.scrollToBottom(), 0);
      }
    });
  }
}
