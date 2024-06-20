import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnDestroy,
  Output,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import {
  MatSlideToggleChange,
  MatSlideToggleModule,
} from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';

import { ReplaySubject, debounceTime, fromEvent, takeUntil } from 'rxjs';

import { InfiniteScrollModule } from 'ngx-infinite-scroll';

import { LoadingIndicatorComponent } from '@app/components/loading-indicator/loading-indicator.component';
import { Message } from '@app/interfaces/message';
import { ConversationService } from '@app/services/conversation.service';

import { FeatureBentoComponent } from '../feature-bento/feature-bento.component';
import { MessageListItemComponent } from '../message-list-item/message-list-item.component';

@Component({
  selector: 'app-message-list',
  standalone: true,
  imports: [
    MessageListItemComponent,
    LoadingIndicatorComponent,
    InfiniteScrollModule,
    MatSlideToggleModule,
    MatTooltipModule,
    MatIconModule,
    FeatureBentoComponent,
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
        <div class="flex h-full flex-col items-center justify-between">
          <div></div>
          <div
            class="prose flex flex-col items-center justify-center gap-4 text-center prose-headings:m-0"
          >
            @if (conversationService.isTemporaryConversation()) {
              <h1>🥷</h1>
              <h3>Incognito mode enabled</h3>
              <p class="text-balance">
                Your messages will not be saved and if you leave this conversation or
                clear with the '<mat-icon fontSet="bi" fontIcon="bi-fire"></mat-icon>'
                button you will not be able to get your messages back again.
              </p>
            } @else {
              <h1>👋</h1>
              <h3>You're using Cognos secure AI messaging</h3>
            }
            <app-feature-bento></app-feature-bento>
          </div>
          <div class="prose flex flex-col items-center">
            <mat-slide-toggle
              (change)="onToggleTemporaryChat($event)"
              [checked]="conversationService.isTemporaryConversation()"
              ><span
                class="underline decoration-dashed"
                matTooltip="Enabling a temporary chat will mean that messages are never stored and will be deleted after the chat is closed"
                >Temporary chat</span
              ></mat-slide-toggle
            >
          </div>
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
export class MessageListComponent implements AfterViewInit, OnDestroy {
  @Input() messages: Message[] = [];
  @Input() messageSending = false;
  @Input() loadingMessages = false;

  @Output() readonly nextPage = new EventEmitter<void>();
  @Output() readonly atBottom = new EventEmitter<boolean>();

  private readonly _wrapper = viewChild('wrapper', { read: ElementRef });

  private readonly _firstLoad = signal(true);
  private readonly _atBottom = signal(false);
  private destroyed$: ReplaySubject<boolean> = new ReplaySubject(1);

  readonly conversationService = inject(ConversationService);

  constructor() {
    effect(() => {
      this.atBottom.emit(this._atBottom());
    });
  }

  scrollToBottom(smooth: boolean = true): void {
    const wrapper = this._wrapper()?.nativeElement;
    wrapper.scroll({
      top: wrapper.scrollHeight,
      left: 0,
      behavior: smooth ? 'smooth' : 'instant',
    });
  }

  onScrollUp(): void {
    this.nextPage.emit();
  }

  onToggleTemporaryChat(event: MatSlideToggleChange): void {
    this.conversationService.setIsTemporaryConversation(event.checked);
  }

  ngAfterViewInit(): void {
    if (this._firstLoad()) {
      this.scrollToBottom(false);
      this._firstLoad.set(false);
    }

    const scroll$ = fromEvent(this._wrapper()?.nativeElement, 'scroll').pipe(
      takeUntil(this.destroyed$),
      debounceTime(100),
    );

    scroll$.subscribe(() => {
      const wrapper = this._wrapper()?.nativeElement;
      const threshold = 150;
      const position = wrapper.scrollTop + wrapper.offsetHeight;
      const height = wrapper.scrollHeight;
      this._atBottom.set(position > height - threshold);
    });
  }

  ngOnDestroy(): void {
    this.destroyed$.next(true);
    this.destroyed$.complete();
  }
}
