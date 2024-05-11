import {
  AfterViewChecked,
  Component,
  ElementRef,
  Input,
  viewChildren,
} from '@angular/core';

import { Message } from '@app/interfaces/message';

import { IcebreakersComponent } from '../icebreakers/icebreakers.component';
import { MessageListItemComponent } from '../message-list-item/message-list-item.component';

@Component({
  selector: 'app-message-list',
  standalone: true,
  imports: [MessageListItemComponent, IcebreakersComponent],
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
export class MessageListComponent implements AfterViewChecked {
  @Input() messages: Message[] = [];

  private readonly _messageListItemElements = viewChildren(MessageListItemComponent, {
    read: ElementRef,
  });

  ngAfterViewChecked(): void {
    const els = this._messageListItemElements();
    if (els.length > 0) {
      els[els.length - 1].nativeElement.scrollIntoView({ behavior: 'smooth' });
    }
  }
}
