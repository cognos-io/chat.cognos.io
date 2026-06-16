import { DatePipe, NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  computed,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';

import { EMPTY, catchError, switchMap } from 'rxjs';

import { Base64 } from 'js-base64';
import { MarkdownComponent } from 'ngx-markdown';

import {
  CognosAssistantMessageComponent,
  CognosBranchSwitcherComponent,
  CognosUserMessageComponent,
  type MessageBranchInfo,
  type MessageTreeAccessors,
  selectActiveBranch,
} from '@cognos/ui-angular';

import { CognosLogoComponent } from '@app/components/cognos-logo/cognos-logo.component';
import { parseConversationData } from '@app/interfaces/conversation';
import { KeyPair } from '@app/interfaces/key-pair';
import { Message, isMessageFromUser, parseMessageData } from '@app/interfaces/message';
import { CognosApiService } from '@app/services/cognos-api.service';
import { CryptoService } from '@app/services/crypto.service';
import { parseBackendDate } from '@app/utils/timestamp';

type ViewState = 'loading' | 'ready' | 'unavailable';

// Same structural accessors the chat uses (message.service.ts) so the public
// view resolves the active branch identically. Kept local to avoid pulling the
// whole MessageService into this unauthenticated route's bundle.
const publicTreeAccessors: MessageTreeAccessors<Message> = {
  getId: (message) => message.record_id,
  getParentId: (message) => message.parentMessageId,
  getOrder: (message) => message.createdAt.getTime(),
};

// PublicConversationComponent is the unauthenticated read view for a shared
// conversation. Everything is decrypted in the browser: the secret half of the
// public-share keypair arrives in the URL fragment, recovers the conversation
// secret, and from there the title and messages are opened locally. A missing
// fragment, an unknown/revoked token, or any decryption failure all collapse to
// the same neutral "link unavailable" state — we never reveal whether a token
// once existed.
//
// Messages render as the active path through the branching tree (newest sibling
// by default), with the same `⑂ N` branch-point tick and ‹ index/count ›
// switcher the chat uses, so readers can explore branches. It's read-only —
// no copy/delete/regenerate actions.
@Component({
  selector: 'app-public-conversation',
  standalone: true,
  imports: [
    NgTemplateOutlet,
    MarkdownComponent,
    CognosUserMessageComponent,
    CognosAssistantMessageComponent,
    CognosBranchSwitcherComponent,
    CognosLogoComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="public-conversation">
      <header class="public-conversation__bar">
        <app-cognos-logo class="public-conversation__logo" palette="dark" />
        <span class="public-conversation__lock" title="End-to-end encrypted">
          Shared securely · decrypted in your browser
        </span>
      </header>

      @switch (state()) {
        @case ('loading') {
          <p class="public-conversation__status">Decrypting shared conversation…</p>
        }
        @case ('unavailable') {
          <section class="public-conversation__empty">
            <h1>This link isn’t available</h1>
            <p>
              The shared conversation may have been unshared, or the link is incomplete.
              Ask the person who shared it for a fresh link.
            </p>
          </section>
        }
        @case ('ready') {
          <article class="public-conversation__content">
            <h1 class="public-conversation__title">{{ title() }}</h1>
            <ol class="public-conversation__messages">
              @for (message of path(); track message.record_id) {
                <li class="public-conversation__message">
                  @if (isMessageFromUser(message.decryptedData)) {
                    <cog-user-message
                      [meta]="userMeta(message)"
                      [branchCount]="branchPointCount(message)"
                    >
                      <ng-container
                        [ngTemplateOutlet]="body"
                        [ngTemplateOutletContext]="{ $implicit: message }"
                      />
                      @if (branchInfo(message); as info) {
                        <div cogMessageActions>
                          <cog-branch-switcher
                            [index]="info.index"
                            [count]="info.count"
                            (previous)="previousBranch(message)"
                            (next)="nextBranch(message)"
                          />
                        </div>
                      }
                    </cog-user-message>
                  } @else {
                    <cog-assistant-message
                      [model]="assistantLabel(message)"
                      [showActions]="false"
                      [time]="messageTime(message)"
                      [branchCount]="branchPointCount(message)"
                    >
                      <ng-container
                        [ngTemplateOutlet]="body"
                        [ngTemplateOutletContext]="{ $implicit: message }"
                      />
                      @if (branchInfo(message); as info) {
                        <div cogMessageActions>
                          <cog-branch-switcher
                            [index]="info.index"
                            [count]="info.count"
                            (previous)="previousBranch(message)"
                            (next)="nextBranch(message)"
                          />
                        </div>
                      }
                    </cog-assistant-message>
                  }
                </li>
              }
            </ol>
          </article>
        }
      }
    </main>

    <footer class="public-conversation__promo">
      <div class="public-conversation__promo-inner">
        <app-cognos-logo class="public-conversation__promo-logo" palette="dark" />
        <p class="public-conversation__promo-text">
          Cognos encrypts your AI chats. This is a public conversation, but only people
          with the link can decrypt and read it. If you care about keeping your AI chats
          private and secure, prefer a European service, and want both proprietary and
          open-source models, go to
          <a href="https://cognos.io/" target="_blank" rel="noopener noreferrer"
            >cognos.io</a
          >
          and sign up today.
        </p>
      </div>
    </footer>

    <ng-template #body let-message>
      @if (message.decryptedData.deleted) {
        <p class="public-conversation__muted">Deleted message</p>
      } @else if (message.decryptedData.content) {
        <markdown class="public-conversation__text" emoji katex>{{
          message.decryptedData.content
        }}</markdown>
      } @else {
        <p class="public-conversation__muted">This message is empty.</p>
      }
    </ng-template>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      min-block-size: 100dvh;
    }

    .public-conversation {
      flex: 1;
      width: 100%;
      max-width: 760px;
      margin: 0 auto;
      padding: var(--cog-space-300, 24px) var(--cog-space-200, 16px);
      display: grid;
      gap: var(--cog-space-300, 24px);
      align-content: start;
    }

    /* Subtle full-width promo band pinned beneath the conversation. */
    .public-conversation__promo {
      border-top: 1px solid var(--cog-border, #e2e2e2);
      background: var(--cog-surface-sunken, #f6f7f9);
    }

    .public-conversation__promo-inner {
      max-width: 760px;
      margin: 0 auto;
      padding: var(--cog-space-250, 20px) var(--cog-space-200, 16px);
      display: flex;
      align-items: center;
      gap: var(--cog-space-200, 16px);
    }

    .public-conversation__promo-logo {
      display: block;
      height: 22px;
      flex: none;
      opacity: 0.85;
    }

    .public-conversation__promo-text {
      margin: 0;
      color: var(--cog-text-subtle, #6b6b6b);
      font-size: var(--cog-fs-caption, 13px);
      line-height: var(--cog-lh-body, 1.5);
    }

    .public-conversation__promo-text a {
      color: var(--cog-brand, #15803d);
      font-weight: var(--cog-fw-semibold, 600);
      text-decoration: none;
    }

    .public-conversation__promo-text a:hover {
      text-decoration: underline;
    }

    @media (max-width: 600px) {
      .public-conversation__promo-inner {
        flex-direction: column;
        align-items: flex-start;
        gap: var(--cog-space-125, 10px);
      }
    }

    .public-conversation__bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--cog-space-200, 16px);
      padding-bottom: var(--cog-space-150, 12px);
      border-bottom: 1px solid var(--cog-border, #e2e2e2);
    }

    .public-conversation__logo {
      display: block;
      height: 24px;
    }

    .public-conversation__lock {
      color: var(--cog-text-subtle, #6b6b6b);
      font-size: var(--cog-fs-body-sm, 13px);
    }

    .public-conversation__status,
    .public-conversation__empty {
      color: var(--cog-text-subtle, #6b6b6b);
      text-align: center;
    }

    .public-conversation__empty h1 {
      color: var(--cog-text, #1a1a1a);
      font-size: var(--cog-fs-h-md, 22px);
    }

    .public-conversation__title {
      color: var(--cog-text, #1a1a1a);
      font-size: var(--cog-fs-h-lg, 28px);
      margin: 0 0 var(--cog-space-200, 16px);
    }

    .public-conversation__messages {
      list-style: none;
      margin: 0;
      padding: 0;
      display: grid;
      gap: var(--cog-space-200, 16px);
    }

    .public-conversation__muted {
      margin: 0;
      color: var(--cog-text-subtlest, #9a9a9a);
      font-style: italic;
    }

    .public-conversation__text {
      display: block;
      color: var(--cog-text, #1a1a1a);
      word-break: break-word;
      line-height: var(--cog-lh-body, 1.5);
    }

    .public-conversation__text :first-child {
      margin-top: 0;
    }

    .public-conversation__text :last-child {
      margin-bottom: 0;
    }
  `,
})
export class PublicConversationComponent implements OnInit {
  private readonly _route = inject(ActivatedRoute);
  private readonly _api = inject(CognosApiService);
  private readonly _crypto = inject(CryptoService);

  readonly state = signal<ViewState>('loading');
  readonly title = signal('');

  readonly isMessageFromUser = isMessageFromUser;

  // The full decrypted message set, plus the per-fork branch selection (parent
  // id -> chosen child id). The active path + branch metadata are derived from
  // these exactly as the chat does.
  private readonly _messages = signal<Message[]>([]);
  private readonly _branchSelections = signal<Record<string, string>>({});

  // Public id→name catalogue so assistant messages show the model name rather
  // than its raw id. Falls back to the id if the lookup is unavailable.
  private readonly _modelNames = signal<Record<string, string>>({});

  private readonly _activeBranch = computed(() =>
    selectActiveBranch(this._messages(), publicTreeAccessors, {
      selections: this._branchSelections(),
    }),
  );

  readonly path = computed(() => this._activeBranch().path);

  ngOnInit(): void {
    // Load the public model-name catalogue independently; assistant labels fall
    // back to the raw model id if it never arrives.
    this._api.getPublicModelNames().subscribe({
      next: (names) =>
        this._modelNames.set(
          Object.fromEntries(names.map((model) => [model.id, model.name])),
        ),
      error: () => {
        /* keep falling back to the model id */
      },
    });

    const token = this._route.snapshot.paramMap.get('token');
    const fragment = this._route.snapshot.fragment;

    if (!token || !fragment) {
      this.state.set('unavailable');
      return;
    }

    let publicShareKeyPair: KeyPair;
    try {
      publicShareKeyPair = this._crypto.keyPairFromSecretKey(
        Base64.toUint8Array(fragment),
      );
    } catch {
      this.state.set('unavailable');
      return;
    }

    this._api
      .getPublicConversation(token)
      .pipe(
        switchMap((conv) => {
          // Recover the conversation keypair from the sealed wrapper using the
          // fragment key, then decrypt the title.
          const conversationSecretKey = this._crypto.openSealedBox(
            Base64.toUint8Array(conv.wrapped_conversation_secret_key),
            publicShareKeyPair,
          );
          const conversationKeyPair: KeyPair = {
            publicKey: Base64.toUint8Array(conv.conversation_public_key),
            secretKey: conversationSecretKey,
          };
          const sharedKey = this._crypto.sharedKey(
            conversationKeyPair.publicKey,
            conversationKeyPair.secretKey,
          );
          const conversationData = parseConversationData(
            this._crypto.openBox(Base64.toUint8Array(conv.data), sharedKey),
          );
          this.title.set(conversationData.title);

          return this._api.listPublicConversationMessages(token).pipe(
            switchMap((list) => {
              this._messages.set(this.decryptMessages(list.items, conversationKeyPair));
              this.state.set('ready');
              return EMPTY;
            }),
          );
        }),
        catchError(() => {
          this.state.set('unavailable');
          return EMPTY;
        }),
      )
      .subscribe();
  }

  branchInfo(message: Message): MessageBranchInfo | undefined {
    return message.record_id
      ? this._activeBranch().branches.get(message.record_id)
      : undefined;
  }

  branchPointCount(message: Message): number {
    return (
      (message.record_id && this._activeBranch().branchPoints.get(message.record_id)) ||
      0
    );
  }

  previousBranch(message: Message): void {
    const info = this.branchInfo(message);
    if (info?.previousId) {
      this.selectBranch(info.parentKey, info.previousId);
    }
  }

  nextBranch(message: Message): void {
    const info = this.branchInfo(message);
    if (info?.nextId) {
      this.selectBranch(info.parentKey, info.nextId);
    }
  }

  assistantLabel(message: Message): string {
    // Map the stored model id to its display name via the public catalogue;
    // fall back to the raw id, then the product name.
    const modelId = message.decryptedData.model_id;
    if (!modelId) {
      return 'Cognos';
    }
    return this._modelNames()[modelId] ?? modelId;
  }

  userMeta(message: Message): string {
    const time = this.formatTimestamp(message.createdAt);
    return time ? `Encrypted · ${time}` : 'Encrypted';
  }

  messageTime(message: Message): string {
    return this.formatTimestamp(message.createdAt);
  }

  private selectBranch(parentKey: string, childId: string): void {
    this._branchSelections.update((selections) => ({
      ...selections,
      [parentKey]: childId,
    }));
  }

  private formatTimestamp(date?: Date): string {
    if (!date || Number.isNaN(date.getTime())) {
      return '';
    }
    return new DatePipe('en-GB').transform(date, 'short') ?? '';
  }

  private decryptMessages(
    items: { id: string; data: string; created: string; parent_message?: string }[],
    conversationKeyPair: KeyPair,
  ): Message[] {
    const messages: Message[] = [];

    for (const item of items) {
      try {
        const decryptedData = parseMessageData(
          this._crypto.openSealedBox(
            Base64.toUint8Array(item.data),
            conversationKeyPair,
          ),
        );
        messages.push({
          record_id: item.id,
          decryptedData,
          createdAt: parseBackendDate(decryptedData.created_at ?? item.created),
          parentMessageId: decryptedData.parent_message_id ?? item.parent_message,
        });
      } catch {
        // A single undecryptable row shouldn't blank the whole view.
        continue;
      }
    }

    return messages;
  }
}
