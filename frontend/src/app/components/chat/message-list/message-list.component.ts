import { Component, ElementRef, Input, viewChildren } from '@angular/core';

import { LoadingIndicatorComponent } from '@app/components/loading-indicator/loading-indicator.component';
import { Message } from '@app/interfaces/message';

import { IcebreakersComponent } from '../icebreakers/icebreakers.component';
import { MessageListItemComponent } from '../message-list-item/message-list-item.component';

@Component({
  selector: 'app-message-list',
  standalone: true,
  imports: [MessageListItemComponent, IcebreakersComponent, LoadingIndicatorComponent],
  template: `
    <div class="message-list-wrapper">
      @for (message of messages; track message) {
        <app-message-list-item [message]="message"></app-message-list-item>
      } @empty {
        <div
          class="flex h-full flex-col items-center justify-between lg:mt-auto lg:h-1/2"
        >
          <div
            class="prose flex flex-col items-center justify-center gap-4 text-center prose-headings:m-0"
          >
            <h1>👋</h1>
            <h3>You're using Cognos secure AI messaging</h3>
          </div>
          <app-icebreakers></app-icebreakers>
        </div>
      }
      @if (messageSending) {
        <app-loading-indicator></app-loading-indicator>
      }
    </div>
  `,
  styles: `
    .message-list-wrapper {
      padding: 1rem 0;
      display: flex;
      flex-direction: column;
      height: 100%;
    }
  `,
})
export class MessageListComponent {
  private _messages: Message[] = [];

  @Input() set messages(value: Message[]) {
    this._messages = value;
    this.scrollToBottom();
  }

  @Input() messageSending = false;

  get messages(): Message[] {
    return this._messages;
  }

  private readonly _messageListItemElements = viewChildren(MessageListItemComponent, {
    read: ElementRef,
  });

  scrollToBottom(): void {
    const els = this._messageListItemElements();
    if (els.length > 0) {
      els[els.length - 1].nativeElement.scrollIntoView({ behavior: 'smooth' });
    }
  }
}
