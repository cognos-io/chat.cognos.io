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

import { EMPTY, catchError, of, switchMap } from 'rxjs';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';
import { Base64 } from 'js-base64';
import { MarkdownComponent } from 'ngx-markdown';

import {
  CognosAssistantMessageComponent,
  CognosBranchSwitcherComponent,
  CognosIconComponent,
  CognosUserMessageComponent,
  type MessageBranchInfo,
  type MessageTreeAccessors,
  selectActiveBranch,
} from '@cognos/ui-angular';

import { CognosLogoComponent } from '@app/components/cognos-logo/cognos-logo.component';
import { parseConversationData } from '@app/interfaces/conversation';
import { KeyPair } from '@app/interfaces/key-pair';
import { Message, isMessageFromUser, parseMessageData } from '@app/interfaces/message';
import { RedactionEntry } from '@app/redaction';
import { CognosApiService } from '@app/services/cognos-api.service';
import { CryptoService } from '@app/services/crypto.service';
import { parseBackendDate } from '@app/utils/timestamp';

type ViewState = 'loading' | 'ready' | 'unavailable';

// A neutral censorship bar shown in place of a hidden sensitive value: a run of
// full-block glyphs the length of the words "redacted text". Plain text (no
// markup) so it renders identically in the markdown body and the escaped title.
const REDACTED_BAR = '█'.repeat('redacted text'.length);

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
    CognosIconComponent,
    CognosLogoComponent,
    TranslocoModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="public-conversation" *transloco="let t">
      <header class="public-conversation__bar">
        <app-cognos-logo class="public-conversation__logo" palette="dark" />
        <div class="public-conversation__bar-actions">
          @if (canRevealSensitive()) {
            <button
              type="button"
              class="public-conversation__reveal"
              (click)="
                revealSensitive() ? hideSensitiveValues() : revealSensitiveValues()
              "
            >
              {{
                revealSensitive()
                  ? t('public.hideSensitive')
                  : t('public.includeSensitive')
              }}
            </button>
          }
          <span class="public-conversation__lock" [title]="t('public.encryptedTitle')">
            {{ t('public.sharedSecurely') }}
          </span>
        </div>
      </header>

      @switch (state()) {
        @case ('loading') {
          <p class="public-conversation__status">{{ t('public.decrypting') }}</p>
        }
        @case ('unavailable') {
          <section class="public-conversation__empty">
            <h1>{{ t('public.unavailableTitle') }}</h1>
            <p>{{ t('public.unavailableBody') }}</p>
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

    <footer class="public-conversation__promo" *transloco="let t">
      <div class="public-conversation__promo-inner">
        <app-cognos-logo class="public-conversation__promo-logo" palette="dark" />
        <p class="public-conversation__promo-text">
          {{ t('public.promoBefore') }}
          <a href="https://cognos.io/" target="_blank" rel="noopener noreferrer"
            >cognos.io</a
          >
          {{ t('public.promoAfter') }}
        </p>
      </div>
    </footer>

    <ng-template #body let-message>
      <ng-container *transloco="let t">
        @if (message.decryptedData.deleted) {
          <p class="public-conversation__muted">{{ t('public.deletedMessage') }}</p>
        } @else if (message.decryptedData.content) {
          <markdown
            class="public-conversation__text"
            emoji
            katex
            [data]="renderBody(message.decryptedData.content)"
          ></markdown>
        } @else {
          <p class="public-conversation__muted">{{ t('public.emptyMessage') }}</p>
        }

        @if (message.decryptedData.reasoning) {
          <details class="public-conversation__reasoning">
            <summary class="public-conversation__reasoning-summary">
              <cog-icon name="brain" [size]="14" aria-hidden="true" />
              {{ t('chat.message.reasoningShow') }}
            </summary>
            <markdown
              class="public-conversation__text"
              emoji
              katex
              [data]="renderBody(message.decryptedData.reasoning)"
            ></markdown>
            <p class="public-conversation__muted">
              {{ t('chat.message.reasoningDisclaimer') }}
            </p>
          </details>
        }
      </ng-container>
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

    .public-conversation__bar-actions {
      display: flex;
      align-items: center;
      gap: var(--cog-space-150, 12px);
    }

    .public-conversation__lock {
      color: var(--cog-text-subtle, #6b6b6b);
      font-size: var(--cog-fs-body-sm, 13px);
    }

    .public-conversation__reveal {
      border: 1px solid var(--cog-border, #e2e2e2);
      border-radius: var(--cog-radius-pill, 999px);
      background: var(--cog-surface, #fff);
      color: var(--cog-text, #1a1a1a);
      padding: 6px 12px;
      font: inherit;
      font-size: var(--cog-fs-body-sm, 13px);
      cursor: pointer;
    }

    .public-conversation__reveal:hover {
      border-color: var(--cog-brand, #15803d);
    }

    .public-conversation__reasoning {
      margin-block-start: var(--cog-space-100, 8px);
      border-inline-start: 2px solid var(--cog-border, #e2e2e2);
      padding-inline-start: var(--cog-space-100, 8px);
    }

    .public-conversation__reasoning-summary {
      display: inline-flex;
      align-items: center;
      gap: var(--cog-space-050, 4px);
      color: var(--cog-text-subtle, #6b6b6b);
      font-size: var(--cog-fs-body-sm, 13px);
      cursor: pointer;
      list-style: none;
    }

    .public-conversation__reasoning-summary::-webkit-details-marker {
      display: none;
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
  private readonly _transloco = inject(TranslocoService);

  readonly state = signal<ViewState>('loading');
  // Raw decrypted title — may contain placeholder tokens, rendered via title().
  private readonly _rawTitle = signal('');
  readonly title = computed(() => this.renderText(this._rawTitle()));

  readonly isMessageFromUser = isMessageFromUser;

  // Two-stage sensitive-value reveal. A reader always starts with sensitive
  // values hidden (placeholders); they can only be revealed if the sharer chose
  // an include-sensitive link (which carries the redaction key, gated by the URL
  // fragment exactly like the conversation key). Redacted-only links never make
  // the values available, so the reveal control is not even offered.
  readonly canRevealSensitive = signal(false);
  readonly revealSensitive = signal(false);
  private readonly _revealLoading = signal(false);
  private readonly _redactionEntries = signal<Map<string, RedactionEntry>>(new Map());
  private _redactionKeyPair: KeyPair | null = null;
  private _token = '';

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
    this._token = token;

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
          this._rawTitle.set(conversationData.title);

          // An include-sensitive share carries the redaction key (sealed to the
          // share key, so only the URL-fragment holder can open it). We recover
          // it now but do NOT decrypt or reveal anything yet — the reader must
          // explicitly opt in. Redacted-only shares offer no reveal at all.
          if (
            conv.mode === 'include_sensitive' &&
            conv.wrapped_redaction_secret_key &&
            conv.redaction_public_key
          ) {
            try {
              this._redactionKeyPair = {
                publicKey: Base64.toUint8Array(conv.redaction_public_key),
                secretKey: this._crypto.openSealedBox(
                  Base64.toUint8Array(conv.wrapped_redaction_secret_key),
                  publicShareKeyPair,
                ),
              };
              this.canRevealSensitive.set(true);
            } catch {
              // Bad key material → no reveal offered; placeholders stay.
            }
          }

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
    return time
      ? this._transloco.translate('public.encryptedAt', { time })
      : this._transloco.translate('public.encrypted');
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

  // renderText turns stored (redacted) text into a plain string: revealed tokens
  // become their originals, hidden ones become the censorship bar. Used for the
  // title, which is interpolated (HTML-escaped) so markup can't be used there.
  renderText(text: string): string {
    return this.replaceTokens(text, () => REDACTED_BAR);
  }

  // renderBody is the markdown-bound variant: hidden tokens become an
  // accessible censorship bar — role="img" + aria-label so screen readers
  // announce "redacted value" instead of a run of block glyphs. The markup is
  // safe (DOMPurify keeps span/role/aria-label) because the body is rendered as
  // markdown, unlike the escaped title.
  renderBody(text: string): string {
    const aria = this._transloco
      .translate('public.redactedAria')
      .replace(/"/g, '&quot;');
    return this.replaceTokens(
      text,
      () =>
        `<span role="img" class="cog-pii-redacted" aria-label="${aria}">${REDACTED_BAR}</span>`,
    );
  }

  private replaceTokens(text: string, hidden: () => string): string {
    if (!text) {
      return '';
    }
    const revealed = this.revealSensitive();
    const entries = this._redactionEntries();
    return text.replace(/\[\[PII_[A-Z]+_[A-Z0-9]+\]\]/g, (token) => {
      if (revealed) {
        const entry = entries.get(token);
        if (entry) {
          return entry.original;
        }
      }
      return hidden();
    });
  }

  // revealSensitiveValues is the explicit opt-in. The first time, it fetches and
  // decrypts the mappings (lazily — they never load unless the reader asks);
  // afterwards it just toggles the display.
  revealSensitiveValues(): void {
    if (!this.canRevealSensitive() || this._revealLoading()) {
      return;
    }
    if (this._redactionEntries().size > 0 || !this._redactionKeyPair) {
      this.revealSensitive.set(true);
      return;
    }

    this._revealLoading.set(true);
    this._api
      .listPublicConversationRedactionEntries(this._token)
      .pipe(catchError(() => of({ items: [] })))
      .subscribe((res) => {
        const map = new Map<string, RedactionEntry>();
        for (const item of res.items) {
          const entry = this.tryDecryptEntry(item.data, this._redactionKeyPair!);
          if (entry) {
            map.set(entry.token, entry);
          }
        }
        this._redactionEntries.set(map);
        this.revealSensitive.set(true);
        this._revealLoading.set(false);
      });
  }

  hideSensitiveValues(): void {
    this.revealSensitive.set(false);
  }

  private tryDecryptEntry(dataB64: string, keyPair: KeyPair): RedactionEntry | null {
    try {
      const plaintext = this._crypto.openSealedBox(
        Base64.toUint8Array(dataB64),
        keyPair,
      );
      return JSON.parse(new TextDecoder().decode(plaintext)) as RedactionEntry;
    } catch {
      return null;
    }
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
