import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  Output,
  viewChild,
} from '@angular/core';

import { InfiniteScrollModule } from 'ngx-infinite-scroll';

import { LoadingIndicatorComponent } from '@app/components/loading-indicator/loading-indicator.component';
import { Message } from '@app/interfaces/message';

import { IcebreakersComponent } from '../icebreakers/icebreakers.component';
import { MessageListItemComponent } from '../message-list-item/message-list-item.component';

@Component({
  selector: 'app-message-list',
  standalone: true,
  imports: [
    MessageListItemComponent,
    IcebreakersComponent,
    LoadingIndicatorComponent,
    InfiniteScrollModule,
  ],
  template: `
    <div
      #wrapper
      class="message-list-wrapper relative"
      infiniteScroll
      (scrolledUp)="onScrollUp()"
      [scrollWindow]="false"
    >
      @if (loadingMessages) {
        <app-loading-indicator></app-loading-indicator>
      }
      @for (message of messages; track message.record_id) {
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
    :host {
      display: flex;
      flex-direction: column;
      min-height: 100%;
      flex-grow: 1;
    }

    .message-list-wrapper {
      padding: 1rem 0;
      display: flex;
      flex-direction: column;
      flex-grow: 1;
      overflow-y: auto;
    }
  `,
})
export class MessageListComponent implements AfterViewInit {
  @Input() messages: Message[] = [];
  @Input() messageSending = false;
  @Input() loadingMessages = false;

  @Output() readonly nextPage = new EventEmitter<void>();

  private readonly _wrapper = viewChild('wrapper', { read: ElementRef });

  scrollToBottom(smooth: boolean = true): void {
    this._wrapper()?.nativeElement.scroll({
      top: this._wrapper()?.nativeElement.scrollHeight,
      left: 0,
      behavior: smooth ? 'smooth' : 'instant',
    });
  }

  onScrollUp(): void {
    this.nextPage.emit();
  }

  ngAfterViewInit(): void {
    this._wrapper()?.nativeElement;
  }
}
