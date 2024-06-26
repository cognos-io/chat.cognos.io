import {
  AfterViewInit,
  Component,
  ElementRef,
  EventEmitter,
  Input,
  OnDestroy,
  Output,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import {
  MatSlideToggleChange,
  MatSlideToggleModule,
} from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';

import { ReplaySubject, debounceTime, fromEvent, takeUntil } from 'rxjs';

import { InfiniteScrollModule } from 'ngx-infinite-scroll';

import { EditConversationDialogComponent } from '@app/components/edit-conversation-dialog/edit-conversation-dialog.component';
import { LoadingIndicatorComponent } from '@app/components/loading-indicator/loading-indicator.component';
import { Message } from '@app/interfaces/message';
import { ConversationService } from '@app/services/conversation.service';

import { FeatureBentoComponent } from '../feature-bento/feature-bento.component';
import { MessageListItemComponent } from '../message-list-item/message-list-item.component';
import {
  TemporaryMessageDialogComponent,
  expiringDurations,
} from '../temporary-message-dialog/temporary-message-dialog.component';

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
    MatDialogModule,
    MatButtonModule,
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
        <div class="circle circle-1"></div>
        <div class="circle circle-2"></div>
        <div class="circle circle-3"></div>
        <div class="flex h-full w-full flex-col items-center justify-between">
          <div></div>
          <div class="flex w-full flex-col items-center justify-center gap-8">
            <app-feature-bento class="w-3/4 xl:max-w-[120ch]"></app-feature-bento>

            <div
              class="prose flex flex-col items-center gap-4 text-center prose-headings:m-0"
            >
              @if (conversationService.isTemporaryConversation()) {
                <h3 class="hidden md:block">🥷 Incognito mode enabled</h3>
                <p class="text-balance">
                  Your messages will not be saved and if you leave this conversation or
                  clear with the '<mat-icon fontSet="bi" fontIcon="bi-fire"></mat-icon>'
                  button you will not be able to get your messages back again.
                </p>
              } @else {
                <h3 class="hidden md:block">
                  👋 You're using Cognos secure AI messaging
                </h3>
                <p class="text-balance">
                  Get started by sending a message using the box below.
                </p>
              }
            </div>
            <div class="flex flex-col items-center justify-center gap-4">
              @if (!conversationService.isTemporaryConversation()) {
                <button
                  class="flex items-center justify-center gap-2"
                  mat-button
                  color="primary"
                  matTooltip="Set a timer for the conversation where messages will be deleted after the timer expires. You have the option to manually 'keep' messages to prevent them from being deleted."
                  aria-label="Set a timer for the conversation where messages will be deleted after the timer expires"
                  (click)="onDisappearingMessages()"
                >
                  <mat-icon fontSet="bi" fontIcon="bi-stopwatch-fill"></mat-icon>
                  Disappearing messages:
                  @if (expirationDelayValue()) {
                    <span class="font-bold">{{ expirationDelayValue() }}</span>
                  } @else {
                    Off
                  }
                </button>
              }

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
        </div>
      }
      @if (messageSending) {
        <app-loading-indicator></app-loading-indicator>
      }
      @if (
        conversationService.conversation() &&
        expirationDelayValue() !== 'Off' &&
        !conversationService.isTemporaryConversation() &&
        expirationDelayValue() !== ''
      ) {
        <button
          mat-button
          color="primary"
          class="mx-auto mt-2 text-balance lg:w-auto"
          (click)="onEditConversation()"
        >
          <mat-icon fontSet="bi" fontIcon="bi-stopwatch-fill"></mat-icon>
          New messages in this conversation will disappear after
          {{ expirationDelayValue() }}
        </button>
      }
    </div>
  `,
  styles: `
    @import 'include-media/dist/include-media';

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

    .circle {
      @apply absolute rounded-full bg-gradient-to-r blur-xl;

      top: var(--circle-top, unset);
      bottom: var(--circle-bottom, unset);
      left: var(--circle-left, unset);
      right: var(--circle-right, unset);
      height: var(--circle-size, 100px);
      width: var(--circle-size, 100px);

      &-1 {
        --circle-top: 15%;
        --circle-left: 10%;
        --circle-size: 100px;

        @apply from-cyan-500/20 to-blue-500/20;

        @include media('>=tablet') {
          --circle-size: 350px;
        }
      }

      &-2 {
        --circle-bottom: 5%;
        --circle-right: 15%;
        --circle-size: 200px;

        @apply from-violet-500/20 to-fuchsia-500/20;

        @include media('>=tablet') {
          --circle-size: 400px;
        }
      }

      &-3 {
        --circle-top: 30%;
        --circle-right: 10%;
        --circle-size: 150px;

        @apply from-purple-500/20 to-pink-500/20;

        @include media('>=tablet') {
          --circle-size: 350px;
        }
      }
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

  private readonly _dialogService = inject(MatDialog);
  private readonly _firstLoad = signal(true);
  private readonly _atBottom = signal(false);
  private destroyed$: ReplaySubject<boolean> = new ReplaySubject(1);

  readonly conversationService = inject(ConversationService);

  public readonly expirationDelayValue = computed(() => {
    let duration = this.conversationService.conversation()?.record
      .expiry_duration as string;

    if (!duration) {
      duration = this.conversationService.expirationDuration();
    }
    return expiringDurations.find((x) => x.value === duration)?.label;
  });

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

  onDisappearingMessages(): void {
    this._dialogService
      .open(TemporaryMessageDialogComponent)
      .afterClosed()
      .pipe(takeUntil(this.destroyed$))
      .subscribe();
  }

  onEditConversation(): void {
    this._dialogService.open(EditConversationDialogComponent, {
      data: {
        conversationId: this.conversationService.conversation()?.record.id ?? '',
      },
    });
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
