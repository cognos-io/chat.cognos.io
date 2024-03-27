import { Component, Input } from '@angular/core';

import { Message } from '@app/interfaces/message';

import { MessageListItemComponent } from '../message-list-item/message-list-item.component';

@Component({
  selector: 'app-message-list',
  standalone: true,
  imports: [MessageListItemComponent],
  templateUrl: './message-list.component.html',
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
