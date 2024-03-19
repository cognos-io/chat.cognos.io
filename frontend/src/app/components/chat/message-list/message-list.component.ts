import { Component } from '@angular/core';

@Component({
  selector: 'app-message-list',
  standalone: true,
  imports: [],
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
