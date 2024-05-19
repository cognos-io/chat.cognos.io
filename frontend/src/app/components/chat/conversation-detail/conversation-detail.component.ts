import { CommonModule } from '@angular/common';
import {
  AfterViewInit,
  Component,
  Input,
  computed,
  inject,
  viewChild,
} from '@angular/core';
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
          [messages]="(messageService.messages$ | async) ?? []"
          [messageSending]="isSending()"
          [loadingMessages]="isLoadingMoreMessages()"
          (nextPage)="messageService.nextPage()"
        ></app-message-list>

        <button
          mat-mini-fab
          color="secondary"
          aria-label="Scroll to bottom of conversation"
          (click)="messageListEl()?.scrollToBottom()"
          class="absolute bottom-8 right-8"
        >
          <mat-icon fontSet="bi" fontIcon="bi-arrow-down"></mat-icon>
        </button>
      </div>
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
    }

    button[mat-mini-fab].absolute {
      position: absolute;
    }
  `,
})
export class ConversationDetailComponent implements AfterViewInit {
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

  @Input()
  set conversationId(conversationId: string) {
    this._conversationService.selectConversation$.next(conversationId ?? '');
  }

  constructor() {
    // Scroll to bottom when something happens in these observables
    this.messageService.sendMessage$.pipe(takeUntilDestroyed()).subscribe(() => {
      this.messageListEl()?.scrollToBottom();
    });
  }

  ngAfterViewInit(): void {
    this.messageListEl()?.scrollToBottom(false);
  }
}
