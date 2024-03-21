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
    }
  `,
})
export class MessageListComponent {
  public messages = new Array(100).fill(0).map((_, i) => `Message ${i}`);
}
