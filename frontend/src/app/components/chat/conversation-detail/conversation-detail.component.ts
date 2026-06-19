import { CommonModule } from '@angular/common';
import { Component, Input, computed, inject, signal, viewChild } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { TranslocoModule } from '@jsverse/transloco';

import { CognosIconButtonComponent } from '@cognos/ui-angular';

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
    CognosIconButtonComponent,
    TranslocoModule,
  ],
  template: `
    <div class="conversation-detail" *transloco="let t">
      @if (isFetching()) {
        <app-loading-indicator></app-loading-indicator>
      } @else {
        <div class="conversation-detail__messages">
          <app-message-list
            class="conversation-detail__message-list"
            [messages]="(messages | async) ?? []"
            [messageSending]="isSending()"
            [loadingMessages]="isLoadingMoreMessages()"
            (nextPage)="messageService.nextPage()"
            (atBottom)="messagesAtBottom.set($event)"
          ></app-message-list>

          @if (!messagesAtBottom() && ((messages | async) ?? []).length !== 0) {
            <div class="conversation-detail__jump">
              <cog-icon-button
                name="chevron-down"
                size="lg"
                [title]="t('chat.conversation.scrollToBottom')"
                (click)="messageListEl()?.scrollToBottom()"
              />
            </div>
          }
        </div>

        <div class="conversation-detail__composer">
          <app-message-form></app-message-form>
        </div>
      }
    </div>
  `,
  styles: `
    :host {
      display: flex;
      width: 100%;
      height: 100%;
      min-height: 0;
      flex: 1;
    }

    .conversation-detail {
      display: grid;
      width: 100%;
      height: 100%;
      min-height: 0;
      grid-template-rows: minmax(0, 1fr) auto;
    }

    .conversation-detail__messages {
      position: relative;
      display: flex;
      min-height: 0;
      flex-direction: column;
    }

    .conversation-detail__message-list {
      min-height: 0;
      flex: 1;
    }

    .conversation-detail__jump {
      position: absolute;
      right: var(--cog-space-200);
      bottom: var(--cog-space-200);
    }

    .conversation-detail__composer {
      width: 100%;
      max-width: var(--chat-container-width);
      margin: 0 auto;
      padding-top: var(--cog-space-150);
      padding-inline: var(--cog-space-200);
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
    this.messageService.messages$.pipe(takeUntilDestroyed()).subscribe(() => {
      if (this.messagesAtBottom()) {
        setTimeout(() => this.messageListEl()?.scrollToBottom(), 0);
      }
    });
  }
}
