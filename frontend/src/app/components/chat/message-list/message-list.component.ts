import { ScrollingModule as ExperimentalScrollingModule } from '@angular/cdk-experimental/scrolling';
import { ScrollingModule } from '@angular/cdk/scrolling';
import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  Output,
  viewChildren,
} from '@angular/core';

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
    ExperimentalScrollingModule,
    ScrollingModule,
  ],
  template: `
    <cdk-virtual-scroll-viewport autosize class="message-list-wrapper">
      @if (messages.length > 0) {
        <app-message-list-item
          *cdkVirtualFor="let message of messages"
          [message]="message"
          (scrolledIndexChange)="onIndexChange($event)"
        ></app-message-list-item>
      } @else {
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
    </cdk-virtual-scroll-viewport>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      min-height: 100%;
    }

    .message-list-wrapper {
      padding: 1rem 0;
      display: flex;
      flex-direction: column;
      flex-grow: 1;
    }
  `,
})
export class MessageListComponent implements AfterViewInit {
  private _messages: Message[] = [];

  @Input() set messages(value: Message[]) {
    this._messages = value;
    this.scrollToBottom();
  }

  @Input() messageSending = false;

  @Output() readonly nextPage = new EventEmitter<void>();

  get messages(): Message[] {
    return this._messages;
  }

  private readonly _messageListItemElements = viewChildren(MessageListItemComponent, {
    read: ElementRef,
  });

  scrollToBottom(smooth: boolean = true): void {
    const els = this._messageListItemElements();
    if (els.length > 0) {
      els[els.length - 1].nativeElement.scrollIntoView({
        behavior: smooth ? 'smooth' : 'instant',
        alignToTop: true,
      });
    }
  }

  onIndexChange(index: Event): void {
    console.log(index);
  }

  ngAfterViewInit(): void {
    this.scrollToBottom(false);
  }
}
