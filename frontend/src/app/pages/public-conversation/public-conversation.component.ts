import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  signal,
} from '@angular/core';
import { ActivatedRoute } from '@angular/router';

import { EMPTY, catchError, switchMap } from 'rxjs';

import { Base64 } from 'js-base64';

import { parseConversationData } from '@app/interfaces/conversation';
import { KeyPair } from '@app/interfaces/key-pair';
import { isMessageFromUser, parseMessageData } from '@app/interfaces/message';
import { CognosApiService } from '@app/services/cognos-api.service';
import { CryptoService } from '@app/services/crypto.service';
import { parseBackendDate } from '@app/utils/timestamp';

type ViewState = 'loading' | 'ready' | 'unavailable';

interface PublicMessage {
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
}

// PublicConversationComponent is the unauthenticated read view for a shared
// conversation. Everything is decrypted in the browser: the secret half of the
// public-share keypair arrives in the URL fragment, recovers the conversation
// secret, and from there the title and messages are opened locally. A missing
// fragment, an unknown/revoked token, or any decryption failure all collapse to
// the same neutral "link unavailable" state — we never reveal whether a token
// once existed.
@Component({
  selector: 'app-public-conversation',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <main class="public-conversation">
      <header class="public-conversation__bar">
        <span class="public-conversation__brand">Cognos</span>
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
              @for (message of messages(); track $index) {
                <li
                  class="public-conversation__message"
                  [class.public-conversation__message--user]="message.role === 'user'"
                  [class.public-conversation__message--assistant]="
                    message.role === 'assistant'
                  "
                >
                  <span class="public-conversation__role">{{
                    message.role === 'user' ? 'User' : 'Assistant'
                  }}</span>
                  <p class="public-conversation__text">{{ message.content }}</p>
                </li>
              }
            </ol>
          </article>
        }
      }
    </main>
  `,
  styles: `
    .public-conversation {
      max-width: 760px;
      margin: 0 auto;
      padding: var(--cog-space-300, 24px) var(--cog-space-200, 16px);
      display: grid;
      gap: var(--cog-space-300, 24px);
    }

    .public-conversation__bar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--cog-space-200, 16px);
      padding-bottom: var(--cog-space-150, 12px);
      border-bottom: 1px solid var(--cog-border, #e2e2e2);
    }

    .public-conversation__brand {
      font-weight: var(--cog-fw-semibold, 600);
      font-size: var(--cog-fs-h-sm, 18px);
      color: var(--cog-text, #1a1a1a);
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

    .public-conversation__message {
      display: grid;
      gap: var(--cog-space-050, 4px);
      padding: var(--cog-space-150, 12px) var(--cog-space-200, 16px);
      border-radius: var(--cog-radius-md, 12px);
      background: var(--cog-surface, #f5f5f5);
    }

    .public-conversation__message--user {
      background: var(--cog-selected-bg, #eef2ff);
    }

    .public-conversation__role {
      font-size: var(--cog-fs-body-sm, 12px);
      font-weight: var(--cog-fw-semibold, 600);
      color: var(--cog-text-subtle, #6b6b6b);
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }

    .public-conversation__text {
      margin: 0;
      color: var(--cog-text, #1a1a1a);
      white-space: pre-wrap;
      word-break: break-word;
      line-height: var(--cog-lh-body, 1.5);
    }
  `,
})
export class PublicConversationComponent implements OnInit {
  private readonly _route = inject(ActivatedRoute);
  private readonly _api = inject(CognosApiService);
  private readonly _crypto = inject(CryptoService);

  readonly state = signal<ViewState>('loading');
  readonly title = signal('');
  readonly messages = signal<PublicMessage[]>([]);

  ngOnInit(): void {
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
              this.messages.set(this.decryptMessages(list.items, conversationKeyPair));
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

  private decryptMessages(
    items: { data: string; created: string }[],
    conversationKeyPair: KeyPair,
  ): PublicMessage[] {
    const decrypted: PublicMessage[] = [];

    for (const item of items) {
      try {
        const data = parseMessageData(
          this._crypto.openSealedBox(
            Base64.toUint8Array(item.data),
            conversationKeyPair,
          ),
        );
        const content = data.deleted
          ? '[message deleted]'
          : (data.content ?? '').trim();
        if (!content) {
          continue;
        }
        decrypted.push({
          role: isMessageFromUser(data) ? 'user' : 'assistant',
          content,
          createdAt: parseBackendDate(data.created_at ?? item.created).getTime(),
        });
      } catch {
        // A single undecryptable row shouldn't blank the whole view.
        continue;
      }
    }

    return decrypted.sort((a, b) => a.createdAt - b.createdAt);
  }
}
