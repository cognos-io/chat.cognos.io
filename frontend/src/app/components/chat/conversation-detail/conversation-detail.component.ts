import { CommonModule } from '@angular/common';
import {
  Component,
  Input,
  computed,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute, Router } from '@angular/router';

import { TranslocoModule } from '@jsverse/transloco';

import {
  CognosButtonComponent,
  CognosIconButtonComponent,
  CognosIconComponent,
} from '@cognos/ui-angular';

import { LoadingIndicatorComponent } from '@app/components/loading-indicator/loading-indicator.component';
import { EarlyHabit } from '@app/components/onboarding/early-habit/early-habit';
import { BookmarkService } from '@app/services/bookmark.service';
import { ConversationService } from '@app/services/conversation.service';
import { FirstValueJourney } from '@app/services/first-value-journey';
import { MessageService, MessageStatus } from '@app/services/message.service';
import { VaultService } from '@app/services/vault.service';

import { ConversationMinimapComponent } from '../conversation-minimap/conversation-minimap.component';
import { MessageFormComponent } from '../message-form/message-form.component';
import { MessageListComponent } from '../message-list/message-list.component';

@Component({
  selector: 'app-conversation-detail',
  standalone: true,
  imports: [
    CommonModule,
    MessageFormComponent,
    MessageListComponent,
    ConversationMinimapComponent,
    LoadingIndicatorComponent,
    EarlyHabit,
    CognosButtonComponent,
    CognosIconButtonComponent,
    CognosIconComponent,
    TranslocoModule,
  ],
  template: `
    <div class="conversation-detail" *transloco="let t">
      @if (isFetching()) {
        <app-loading-indicator></app-loading-indicator>
      } @else {
        <div class="conversation-detail__messages">
          <app-message-list
            class="conversation-detail__message-list"
            [messages]="(messages | async) ?? []"
            [messageSending]="isSending()"
            [loadingMessages]="isLoadingMoreMessages()"
            (nextPage)="messageService.nextPage()"
            (atBottom)="messagesAtBottom.set($event)"
          ></app-message-list>

          <app-conversation-minimap
            (jumpTo)="messageListEl()?.scrollToMessage($event)"
          ></app-conversation-minimap>

          @if (!messagesAtBottom() && ((messages | async) ?? []).length !== 0) {
            <div class="conversation-detail__jump">
              <cog-icon-button
                name="chevron-down"
                size="lg"
                [title]="t('chat.conversation.scrollToBottom')"
                (click)="messageListEl()?.scrollToBottom()"
              />
            </div>
          }
        </div>

        @if (firstValueJourney.habitVisible()) {
          <app-early-habit class="conversation-detail__habit" />
        }

        @if (messageService.sendFailed()) {
          <div class="conversation-detail__retry" role="alert">
            <cog-icon name="triangle-alert" [size]="18" tone="danger" />
            <div class="conversation-detail__retry-copy">
              <p class="conversation-detail__retry-title">
                {{ t('chat.retry.title') }}
              </p>
              <p class="conversation-detail__retry-body">{{ t('chat.retry.body') }}</p>
            </div>
            <cog-button
              appearance="default"
              icon="rotate-cw"
              (click)="messageService.retryFailedSend()"
            >
              {{ t('chat.retry.action') }}
            </cog-button>
          </div>
        }

        <div class="conversation-detail__composer">
          <app-message-form></app-message-form>
          <p class="conversation-detail__disclaimer">
            {{ t('chat.accuracyDisclaimer') }}
          </p>
        </div>
      }
    </div>
  `,
  styles: `
    :host {
      display: flex;
      width: 100%;
      height: 100%;
      min-height: 0;
      flex: 1;
    }

    .conversation-detail {
      display: grid;
      width: 100%;
      height: 100%;
      min-height: 0;
      grid-template-rows: minmax(0, 1fr) auto;
    }

    .conversation-detail__messages {
      position: relative;
      display: flex;
      min-height: 0;
      flex-direction: column;
    }

    .conversation-detail__message-list {
      min-height: 0;
      flex: 1;
    }

    .conversation-detail__jump {
      position: absolute;
      right: var(--cog-space-200);
      bottom: var(--cog-space-200);
    }

    .conversation-detail__retry {
      display: flex;
      align-items: center;
      gap: var(--cog-space-150);
      width: 100%;
      max-width: var(--chat-container-width);
      margin: var(--cog-space-150) auto 0;
      padding: var(--cog-space-150);
      border: var(--cog-border-width) solid var(--cog-danger-border);
      border-radius: var(--cog-radius-md);
      background: var(--cog-danger-bg);
    }

    .conversation-detail__habit {
      width: calc(100% - 2 * var(--cog-space-400));
      max-width: var(--chat-container-width);
      margin: var(--cog-space-100) auto 0;
    }

    .conversation-detail__retry-copy {
      flex: 1;
      min-width: 0;
    }

    .conversation-detail__retry-title {
      margin: 0;
      color: var(--cog-text);
      font-size: var(--cog-fs-body-sm);
      font-weight: var(--cog-fw-semibold);
    }

    .conversation-detail__retry-body {
      margin: var(--cog-space-025) 0 0;
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-caption);
      line-height: var(--cog-lh-caption);
    }

    .conversation-detail__composer {
      width: 100%;
      max-width: var(--chat-container-width);
      margin: 0 auto;
      padding-top: var(--cog-space-150);
      padding-inline: var(--cog-space-200);
    }

    /* Persistent, unobtrusive accuracy disclaimer under the composer — the
       standard "AI can make mistakes" affordance. */
    .conversation-detail__disclaimer {
      margin: var(--cog-space-075) 0 var(--cog-space-050);
      text-align: center;
      color: var(--cog-text-subtlest);
      font-size: var(--cog-fs-caption);
      line-height: var(--cog-lh-caption);
    }

    /* On mobile the composer fills the width edge-to-edge — the outer padding
       wastes scarce horizontal space. */
    @media (max-width: 640px) {
      .conversation-detail__composer {
        padding-top: var(--cog-space-100);
        padding-inline: 0;
      }
    }
  `,
})
export class ConversationDetailComponent {
  private readonly _conversationService = inject(ConversationService);
  private readonly _bookmarkService = inject(BookmarkService);
  private readonly _vault = inject(VaultService);
  private readonly _route = inject(ActivatedRoute);
  private readonly _router = inject(Router);

  // Guards repeated loads: bookmarks are (re)loaded once per active conversation.
  private _bookmarksLoadedFor?: string;

  readonly messageListEl = viewChild(MessageListComponent);

  readonly messageService = inject(MessageService);
  readonly firstValueJourney = inject(FirstValueJourney);
  readonly isFetching = computed(
    () => this.messageService.status() === MessageStatus.Fetching,
  );
  readonly isSending = computed(
    () => this.messageService.status() === MessageStatus.Sending,
  );
  readonly isLoadingMoreMessages = computed(
    () => this.messageService.status() === MessageStatus.LoadingMoreMessages,
  );

  readonly messagesAtBottom = signal(false);

  @Input()
  set conversationId(conversationId: string) {
    this._conversationService.selectConversation$.next(conversationId ?? '');
  }

  get messages() {
    return this.messageService.messages$;
  }

  constructor() {
    this.messageService.messages$.pipe(takeUntilDestroyed()).subscribe(() => {
      if (this.messagesAtBottom()) {
        setTimeout(() => this.messageListEl()?.scrollToBottom(), 0);
      }
    });

    // Load this conversation's bookmarks once it's the active, persisted chat
    // and the vault is unlocked (bookmarks are sealed to the user's vault key).
    effect(() => {
      const conversation = this._conversationService.conversation();
      const unlocked = !!this._vault.keyPair();
      const id = conversation?.record.id;
      if (
        !id ||
        !unlocked ||
        this._conversationService.isTemporaryConversation() ||
        this._bookmarksLoadedFor === id
      ) {
        return;
      }
      this._bookmarksLoadedFor = id;
      this._bookmarkService.loadForConversation(id).subscribe({
        error: () => {
          // Allow a later retry if the load failed.
          if (this._bookmarksLoadedFor === id) {
            this._bookmarksLoadedFor = undefined;
          }
        },
      });
    });

    // Arriving from the bookmarks settings page with ?m=<messageId> jumps to
    // that message once it's rendered. It may be paginated out, so retry a few
    // times before giving up quietly, then clear the param.
    this._route.queryParamMap.pipe(takeUntilDestroyed()).subscribe((params) => {
      const messageId = params.get('m');
      if (messageId) {
        this.scrollToBookmarkedMessage(messageId, 5);
      }
    });
  }

  private scrollToBookmarkedMessage(messageId: string, retries: number): void {
    setTimeout(() => {
      const found = this.messageListEl()?.scrollToMessage(messageId) ?? false;
      if (found || retries <= 0) {
        this.clearJumpParam();
        return;
      }
      this.scrollToBookmarkedMessage(messageId, retries - 1);
    }, 150);
  }

  private clearJumpParam(): void {
    this._router.navigate([], {
      relativeTo: this._route,
      queryParams: { m: null },
      queryParamsHandling: 'merge',
      replaceUrl: true,
    });
  }
}
