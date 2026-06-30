import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  signal,
} from '@angular/core';

import { EMPTY, catchError, finalize } from 'rxjs';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';

import {
  CognosButtonComponent,
  CognosDialogSurfaceComponent,
} from '@cognos/ui-angular';

import { type PublicShareMode } from '@app/services/cognos-api.service';
import { ConversationService } from '@app/services/conversation.service';
import { ErrorService } from '@app/services/error.service';
import { PublicShareService } from '@app/services/public-share.service';

type ShareState = 'checking' | 'idle' | 'shared';

// ShareConversationDialogComponent lets an owner publish a public link for the
// current conversation and copy it. The link contains the decryption key in
// its fragment, so anyone with the full link can read the conversation — the
// copy reflects that. Creating/reading the share is gated server-side to
// conversation admins.
@Component({
  selector: 'app-share-conversation-dialog',
  standalone: true,
  imports: [CognosDialogSurfaceComponent, CognosButtonComponent, TranslocoModule],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <cog-dialog-surface
      *transloco="let t"
      [title]="t('dialogs.share.title')"
      [footer]="true"
      [width]="560"
      (close)="close()"
    >
      <div class="share-dialog">
        @switch (state()) {
          @case ('checking') {
            <p class="share-dialog__status">{{ t('dialogs.share.checking') }}</p>
          }
          @case ('idle') {
            <div class="share-dialog__copy">
              <h3>{{ t('dialogs.share.createHeading') }}</h3>
              <p>{{ t('dialogs.share.createBody') }}</p>
              <p class="share-dialog__reasoning-note">
                {{ t('dialogs.share.reasoningWarning') }}
              </p>
            </div>
            <fieldset class="share-dialog__modes">
              <legend>{{ t('dialogs.share.redaction.heading') }}</legend>
              <label class="share-dialog__mode">
                <input
                  type="radio"
                  name="share-mode"
                  value="redacted_only"
                  [checked]="mode() === 'redacted_only'"
                  (change)="mode.set('redacted_only')"
                />
                <span class="share-dialog__mode-text">
                  <span class="share-dialog__mode-label">
                    {{ t('dialogs.share.redaction.redactedLabel') }}
                  </span>
                  <span class="share-dialog__mode-hint">
                    {{ t('dialogs.share.redaction.redactedHint') }}
                  </span>
                </span>
              </label>
              <label class="share-dialog__mode">
                <input
                  type="radio"
                  name="share-mode"
                  value="include_sensitive"
                  [checked]="mode() === 'include_sensitive'"
                  (change)="mode.set('include_sensitive')"
                />
                <span class="share-dialog__mode-text">
                  <span class="share-dialog__mode-label">
                    {{ t('dialogs.share.redaction.sensitiveLabel') }}
                  </span>
                  <span class="share-dialog__mode-hint share-dialog__mode-hint--warn">
                    {{ t('dialogs.share.redaction.sensitiveHint') }}
                  </span>
                </span>
              </label>
            </fieldset>
          }
          @case ('shared') {
            <div class="share-dialog__copy">
              <h3>{{ t('dialogs.share.sharedHeading') }}</h3>
              <p>{{ t('dialogs.share.sharedBody') }}</p>
            </div>
            <div class="share-dialog__link">
              <input
                class="share-dialog__url"
                type="text"
                readonly
                [value]="shareUrl()"
                (focus)="selectAll($event)"
                [attr.aria-label]="t('dialogs.share.linkAriaLabel')"
              />
              <cog-button appearance="default" (click)="copy()">
                {{ copied() ? t('dialogs.share.copied') : t('dialogs.share.copy') }}
              </cog-button>
            </div>
          }
        }
      </div>

      <div cogDialogFooter>
        <cog-button appearance="subtle" (click)="close()">{{
          t('dialogs.share.close')
        }}</cog-button>
        @if (state() === 'idle') {
          <cog-button
            appearance="primary"
            [disabled]="working()"
            (click)="createLink()"
          >
            {{ t('dialogs.share.createLink') }}
          </cog-button>
        }
        @if (state() === 'shared') {
          <cog-button appearance="danger" [disabled]="working()" (click)="revoke()">
            {{ t('dialogs.share.stopSharing') }}
          </cog-button>
        }
      </div>
    </cog-dialog-surface>
  `,
  styles: `
    .share-dialog {
      display: grid;
      gap: var(--cog-space-200);
    }

    .share-dialog__copy {
      display: grid;
      gap: var(--cog-space-100);
    }

    .share-dialog__copy h3 {
      margin: 0;
      color: var(--cog-text);
      font-size: var(--cog-fs-h-sm);
      font-weight: var(--cog-fw-h-sm);
      line-height: var(--cog-lh-h-sm);
    }

    .share-dialog__copy p,
    .share-dialog__status {
      margin: 0;
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-body);
      line-height: var(--cog-lh-body);
    }

    .share-dialog__link {
      display: flex;
      gap: var(--cog-space-100);
      align-items: stretch;
    }

    /* Let the Copy button fill the row height so it matches the input field.
       The button host stretches via align-items: stretch above; making it a
       flex container lets its inner <button> grow to that full height. */
    .share-dialog__link cog-button {
      display: flex;
    }

    .share-dialog__url {
      flex: 1;
      min-height: 40px;
      border: 2px solid var(--cog-border);
      border-radius: var(--cog-radius-sm);
      background: var(--cog-input-bg);
      color: var(--cog-text);
      padding: 0 var(--cog-space-150);
      font: inherit;
      outline: 0;
    }

    .share-dialog__modes {
      display: grid;
      gap: var(--cog-space-150);
      margin: 0;
      padding: var(--cog-space-150);
      border: 1px solid var(--cog-border);
      border-radius: var(--cog-radius-sm);
    }

    .share-dialog__modes legend {
      padding: 0 var(--cog-space-075);
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-caption);
    }

    .share-dialog__mode {
      display: flex;
      gap: var(--cog-space-100);
      align-items: center;
      cursor: pointer;
    }

    .share-dialog__mode-text {
      display: grid;
      gap: 2px;
    }

    .share-dialog__mode-label {
      color: var(--cog-text);
      font-weight: var(--cog-fw-semibold);
    }

    .share-dialog__mode-hint {
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-body-sm);
      line-height: var(--cog-lh-body-sm);
    }

    .share-dialog__mode-hint--warn {
      color: var(--cog-danger-text);
    }

    .share-dialog__copy p.share-dialog__reasoning-note {
      color: var(--cog-danger-text);
      font-size: var(--cog-fs-body-sm);
    }
  `,
})
export class ShareConversationDialogComponent implements OnInit {
  private readonly _dialogRef = inject(DialogRef<void>);
  private readonly _conversationService = inject(ConversationService);
  private readonly _publicShareService = inject(PublicShareService);
  private readonly _errorService = inject(ErrorService);
  private readonly _transloco = inject(TranslocoService);

  readonly data: { conversationId: string } = inject(DIALOG_DATA);

  readonly state = signal<ShareState>('checking');
  readonly shareUrl = signal('');
  readonly copied = signal(false);
  readonly working = signal(false);
  // Defaults to the safe mode; the user opts into including sensitive values.
  readonly mode = signal<PublicShareMode>('redacted_only');

  ngOnInit(): void {
    const conversation = this._conversationService.getConversation(
      this.data.conversationId,
    )();

    if (!conversation) {
      this.state.set('idle');
      return;
    }

    this._publicShareService
      .existingShareUrl(conversation)
      .pipe(
        catchError(() => {
          // Treat a lookup failure as "not shared yet" so the user can still
          // create a link rather than getting stuck on an error.
          this.state.set('idle');
          return EMPTY;
        }),
      )
      .subscribe((url) => {
        if (url) {
          this.shareUrl.set(url);
          this.state.set('shared');
        } else {
          this.state.set('idle');
        }
      });
  }

  createLink(): void {
    const conversation = this._conversationService.getConversation(
      this.data.conversationId,
    )();
    if (!conversation || this.working()) {
      return;
    }

    this.working.set(true);
    this._publicShareService
      .share(conversation, this.mode())
      .pipe(
        finalize(() => this.working.set(false)),
        catchError(() => {
          this._errorService.alert(
            this._transloco.translate('dialogs.share.createError'),
          );
          return EMPTY;
        }),
      )
      .subscribe((url) => {
        this.shareUrl.set(url);
        this.state.set('shared');
      });
  }

  revoke(): void {
    const conversation = this._conversationService.getConversation(
      this.data.conversationId,
    )();
    if (!conversation || this.working()) {
      return;
    }

    this.working.set(true);
    this._publicShareService
      .revoke(conversation)
      .pipe(
        finalize(() => this.working.set(false)),
        catchError(() => {
          this._errorService.alert(
            this._transloco.translate('dialogs.share.revokeError'),
          );
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this.shareUrl.set('');
        this.copied.set(false);
        this.state.set('idle');
      });
  }

  copy(): void {
    const url = this.shareUrl();
    if (!url) {
      return;
    }

    navigator.clipboard
      .writeText(url)
      .then(() => this.copied.set(true))
      .catch(() =>
        this._errorService.alert(this._transloco.translate('dialogs.share.copyError')),
      );
  }

  selectAll(event: FocusEvent): void {
    (event.target as HTMLInputElement | null)?.select();
  }

  close(): void {
    this._dialogRef.close();
  }
}
