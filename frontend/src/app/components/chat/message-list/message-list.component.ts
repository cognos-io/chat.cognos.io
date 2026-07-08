import { Dialog } from '@angular/cdk/dialog';
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

import { ReplaySubject, debounceTime, fromEvent, takeUntil } from 'rxjs';

import { TranslocoModule } from '@jsverse/transloco';
import { InfiniteScrollModule } from 'ngx-infinite-scroll';

import {
  CognosButtonComponent,
  CognosSectionMessageComponent,
  CognosToggleComponent,
} from '@cognos/ui-angular';

import { EditConversationDialogComponent } from '@app/components/edit-conversation-dialog/edit-conversation-dialog.component';
import { LoadingIndicatorComponent } from '@app/components/loading-indicator/loading-indicator.component';
import { Message } from '@app/interfaces/message';
import { ConversationService } from '@app/services/conversation.service';
import { cognosDialogOptions } from '@app/utils/dialog-options';
import { scrollMessageIntoView } from '@app/utils/scroll-to-message';

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
    CognosToggleComponent,
    CognosButtonComponent,
    CognosSectionMessageComponent,
    TranslocoModule,
  ],
  template: `
    <div
      #wrapper
      class="message-list"
      *transloco="let t"
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
        <div class="message-list__empty-shell">
          <div class="message-list__circle message-list__circle--one"></div>
          <div class="message-list__circle message-list__circle--two"></div>
          <div class="message-list__circle message-list__circle--three"></div>

          <div class="message-list__empty">
            @if (conversationService.isTemporaryConversation()) {
              <cog-section-message
                [title]="t('chat.empty.incognitoTitle')"
                tone="success"
              >
                {{ t('chat.empty.incognitoBody') }}
              </cog-section-message>
            } @else {
              <cog-section-message [title]="t('chat.empty.secureTitle')" tone="info">
                {{ t('chat.empty.secureBody') }}
              </cog-section-message>
            }
          </div>

          <div class="message-list__empty-actions">
            @if (!conversationService.isTemporaryConversation()) {
              <cog-button
                appearance="default"
                icon="rotate-cw"
                type="button"
                (click)="onDisappearingMessages()"
              >
                {{ t('chat.empty.disappearingMessages') }}
                @if (expirationDurationKey() && expirationDurationKey() !== 'off') {
                  {{ t('chat.temporary.durations.' + expirationDurationKey()) }}
                } @else {
                  {{ t('chat.empty.disappearingOff') }}
                }
              </cog-button>
            }

            <span class="message-list__toggle">
              <cog-toggle
                [checked]="conversationService.isTemporaryConversation()"
                [label]="t('chat.empty.temporaryChat')"
                (checkedChange)="onToggleTemporaryChat($event)"
              ></cog-toggle>
              <span>{{ t('chat.empty.temporaryChat') }}</span>
            </span>
          </div>
        </div>
      }

      @if (messageSending) {
        <app-loading-indicator></app-loading-indicator>
      }

      @if (
        conversationService.conversation() &&
        expirationDurationKey() &&
        expirationDurationKey() !== 'off' &&
        !conversationService.isTemporaryConversation()
      ) {
        <div class="message-list__banner">
          <cog-button
            appearance="default"
            icon="rotate-cw"
            (click)="onEditConversation()"
          >
            {{
              t('chat.message.disappearAfter', {
                duration: t('chat.temporary.durations.' + expirationDurationKey()),
              })
            }}
          </cog-button>
        </div>
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

    .message-list {
      position: relative;
      display: flex;
      flex-direction: column;
      flex-grow: 1;
      overflow-y: auto;
      padding-block: var(--cog-space-100);
    }

    .message-list__empty-shell {
      position: relative;
      display: grid;
      min-height: 100%;
      flex: 1;
      grid-template-rows: minmax(0, 1fr) auto;
      gap: var(--cog-space-300);
      padding: var(--cog-space-300) 0;
    }

    .message-list__empty {
      position: relative;
      z-index: 1;
      display: grid;
      width: 100%;
      max-width: min(100%, 960px);
      gap: var(--cog-space-300);
      align-self: start;
      justify-self: center;
    }

    .message-list__empty-actions {
      position: relative;
      z-index: 1;
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: var(--cog-space-150);
    }

    .message-list__toggle {
      display: inline-flex;
      align-items: center;
      gap: var(--cog-space-100);
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-body);
      line-height: var(--cog-lh-body);
    }

    .message-list__banner {
      display: flex;
      justify-content: center;
      margin-top: var(--cog-space-150);
    }

    .message-list__circle {
      position: absolute;
      border-radius: var(--cog-radius-pill);
      filter: blur(52px);
      opacity: 0.5;
    }

    .message-list__circle--one {
      top: 15%;
      left: 8%;
      width: 140px;
      height: 140px;
      background: color-mix(in srgb, var(--cog-info) 20%, transparent);
    }

    .message-list__circle--two {
      right: 12%;
      bottom: 10%;
      width: 180px;
      height: 180px;
      background: color-mix(in srgb, var(--cog-loz-purple-fg) 20%, transparent);
    }

    .message-list__circle--three {
      top: 34%;
      right: 16%;
      width: 120px;
      height: 120px;
      background: color-mix(in srgb, var(--cog-success) 18%, transparent);
    }

    @media (max-width: 767px) {
      .message-list__empty-shell,
      .message-list__empty {
        gap: var(--cog-space-200);
      }

      .message-list__circle--one,
      .message-list__circle--two,
      .message-list__circle--three {
        width: 96px;
        height: 96px;
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

  private readonly _dialog = inject(Dialog);
  private readonly _wrapper = viewChild('wrapper', { read: ElementRef });
  private readonly _firstLoad = signal(true);
  private readonly _atBottom = signal(false);
  private destroyed$: ReplaySubject<boolean> = new ReplaySubject(1);

  readonly conversationService = inject(ConversationService);

  // The translation key for the active disappearing-message duration
  // ('off' | 'hours24' | …), resolved against chat.temporary.durations.*.
  public readonly expirationDurationKey = computed(() => {
    let duration = this.conversationService.conversation()?.record
      .expiry_duration as string;

    if (!duration) {
      duration = this.conversationService.expirationDuration();
    }
    return expiringDurations.find((x) => x.value === duration)?.key;
  });

  constructor() {
    effect(() => {
      this.atBottom.emit(this._atBottom());
    });
  }

  scrollToBottom(smooth: boolean = true): void {
    const wrapper = this._wrapper()?.nativeElement;
    wrapper?.scroll({
      top: wrapper.scrollHeight,
      left: 0,
      behavior: smooth ? 'smooth' : 'instant',
    });
  }

  /**
   * Scroll a message into view by its persisted record id (used by the minimap
   * and bookmark jump). Returns false when the message isn't in the currently
   * rendered branch/page (paginated out, temporary chat, or still streaming).
   */
  scrollToMessage(recordId: string, smooth: boolean = true): boolean {
    return scrollMessageIntoView(this._wrapper()?.nativeElement, recordId, smooth);
  }

  onScrollUp(): void {
    this.nextPage.emit();
  }

  onToggleTemporaryChat(checked: boolean): void {
    this.conversationService.setIsTemporaryConversation(checked);
  }

  onDisappearingMessages(): void {
    this._dialog
      .open(TemporaryMessageDialogComponent, cognosDialogOptions)
      .closed.subscribe();
  }

  onEditConversation(): void {
    this._dialog.open(EditConversationDialogComponent, {
      ...cognosDialogOptions,
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

    const wrapper = this._wrapper()?.nativeElement;
    if (!wrapper) {
      return;
    }

    const scroll$ = fromEvent(wrapper, 'scroll').pipe(
      takeUntil(this.destroyed$),
      debounceTime(100),
    );

    scroll$.subscribe(() => {
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
