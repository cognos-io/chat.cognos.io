import { Component } from '@angular/core';

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
      justify-content: center;
      align-items: center;
      height: 100%;
    }
  `,
})
export class MessageListComponent {
  public messages = [];
}
