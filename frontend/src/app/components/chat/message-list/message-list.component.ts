import { Component, Input } from '@angular/core';

import { Message } from '@app/interfaces/message';

import { MessageListItemComponent } from '../message-list-item/message-list-item.component';

@Component({
  selector: 'app-message-list',
  standalone: true,
  imports: [MessageListItemComponent],
  template: `
    <div class="message-list-wrapper">
      @for (message of messages; track message) {
        <app-message-list-item [message]="message"></app-message-list-item>
      } @empty {
        <div class="empty-message">
          <p>No messages yet</p>
        </div>
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
  @Input() messages: Message[] = [];
}
