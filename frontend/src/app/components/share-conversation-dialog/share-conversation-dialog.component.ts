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
  CognosCalloutComponent,
  CognosDialogActionsComponent,
  CognosDialogSurfaceComponent,
  CognosIconComponent,
  CognosLozengeComponent,
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
  imports: [
    CognosDialogSurfaceComponent,
    CognosDialogActionsComponent,
    CognosButtonComponent,
    CognosCalloutComponent,
    CognosLozengeComponent,
    CognosIconComponent,
    TranslocoModule,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <cog-dialog-surface
      *transloco="let t"
      icon="lock"
      iconTone="success"
      [title]="t('dialogs.share.title')"
      [subtitle]="t('dialogs.share.subtitle')"
      [closeLabel]="t('common.close')"
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
            <p class="share-dialog__body">{{ t('dialogs.share.body') }}</p>

            <cog-callout tone="success" icon="key-round">
              <span [innerHTML]="t('dialogs.share.keyNote')"></span>
            </cog-callout>

            <cog-callout tone="warning" icon="brain">
              {{ t('dialogs.share.reasoningWarning') }}
            </cog-callout>

            <fieldset class="share-dialog__modes">
              <legend class="share-dialog__overline">
                {{ t('dialogs.share.redaction.heading') }}
              </legend>

              <label
                class="share-dialog__mode"
                [class.share-dialog__mode--selected]="mode() === 'redacted_only'"
              >
                <input
                  type="radio"
                  name="share-mode"
                  value="redacted_only"
                  [checked]="mode() === 'redacted_only'"
                  (change)="mode.set('redacted_only')"
                />
                <span class="share-dialog__mode-text">
                  <span class="share-dialog__mode-heading">
                    <span class="share-dialog__mode-label">
                      {{ t('dialogs.share.redaction.redactedLabel') }}
                    </span>
                    <cog-lozenge tone="green">
                      {{ t('dialogs.share.redaction.recommended') }}
                    </cog-lozenge>
                  </span>
                  <span class="share-dialog__mode-hint">
                    {{ t('dialogs.share.redaction.redactedHint') }}
                  </span>
                </span>
              </label>

              <label
                class="share-dialog__mode"
                [class.share-dialog__mode--danger]="mode() === 'include_sensitive'"
              >
                <input
                  type="radio"
                  name="share-mode"
                  value="include_sensitive"
                  [checked]="mode() === 'include_sensitive'"
                  (change)="mode.set('include_sensitive')"
                />
                <span class="share-dialog__mode-text">
                  <span class="share-dialog__mode-heading">
                    <span class="share-dialog__mode-label">
                      {{ t('dialogs.share.redaction.sensitiveLabel') }}
                    </span>
                    <cog-lozenge tone="red">
                      {{ t('dialogs.share.redaction.higherRisk') }}
                    </cog-lozenge>
                  </span>
                  <span class="share-dialog__mode-hint share-dialog__mode-hint--warn">
                    {{ t('dialogs.share.redaction.sensitiveHint') }}
                  </span>
                </span>
              </label>
            </fieldset>
          }
          @case ('shared') {
            <p class="share-dialog__live">
              <span class="share-dialog__live-badge">
                <span class="share-dialog__live-dot" aria-hidden="true"></span>
                {{ t('dialogs.share.live') }}
              </span>
              <span class="share-dialog__live-text">
                {{
                  sharedMode() === 'include_sensitive'
                    ? t('dialogs.share.statusSensitive')
                    : t('dialogs.share.statusRedacted')
                }}
              </span>
            </p>

            <p class="share-dialog__body">{{ t('dialogs.share.body') }}</p>

            <div class="share-dialog__link-group">
              <span class="share-dialog__overline">
                {{ t('dialogs.share.publicLinkLabel') }}
              </span>
              <div class="share-dialog__link">
                <span class="share-dialog__url-wrap">
                  <cog-icon
                    class="share-dialog__url-icon"
                    name="link"
                    [size]="16"
                    tone="text-subtle"
                  />
                  <input
                    class="share-dialog__url"
                    type="text"
                    readonly
                    [value]="shareUrl()"
                    (focus)="selectAll($event)"
                    [attr.aria-label]="t('dialogs.share.linkAriaLabel')"
                  />
                </span>
                <cog-button appearance="default" icon="copy" (click)="copy()">
                  {{ copied() ? t('dialogs.share.copied') : t('dialogs.share.copy') }}
                </cog-button>
              </div>
            </div>

            <cog-callout tone="success" icon="key-round">
              <span [innerHTML]="t('dialogs.share.keyNote')"></span>
            </cog-callout>
          }
        }
      </div>

      <cog-dialog-actions cogDialogFooter>
        <cog-button appearance="subtle" (click)="close()">{{
          t('dialogs.share.close')
        }}</cog-button>
        @if (state() === 'idle') {
          <cog-button
            appearance="primary"
            icon="link"
            [disabled]="working()"
            (click)="createLink()"
          >
            {{ t('dialogs.share.createLink') }}
          </cog-button>
        }
        @if (state() === 'shared') {
          <cog-button
            appearance="danger"
            icon="shield-x"
            [disabled]="working()"
            (click)="revoke()"
          >
            {{ t('dialogs.share.stopSharing') }}
          </cog-button>
        }
      </cog-dialog-actions>
    </cog-dialog-surface>
  `,
  styles: `
    .share-dialog {
      display: grid;
      gap: var(--cog-space-200);
    }

    .share-dialog__body,
    .share-dialog__status {
      margin: 0;
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-body);
      line-height: var(--cog-lh-body);
    }

    .share-dialog__overline {
      display: block;
      padding: 0;
      color: var(--cog-text-subtlest);
      font-size: var(--cog-fs-overline);
      font-weight: var(--cog-fw-overline);
      line-height: var(--cog-lh-overline);
      letter-spacing: var(--cog-ls-overline);
      text-transform: var(--cog-tt-overline);
    }

    /* Live status row: a green pulse badge next to the human-readable mode. */
    .share-dialog__live {
      display: flex;
      align-items: center;
      gap: var(--cog-space-150);
      margin: 0;
    }

    .share-dialog__live-badge {
      display: inline-flex;
      align-items: center;
      gap: var(--cog-space-075);
      color: var(--cog-success-text);
      font-size: var(--cog-fs-body-sm);
      font-weight: var(--cog-fw-semibold);
    }

    .share-dialog__live-dot {
      width: 8px;
      height: 8px;
      border-radius: var(--cog-radius-pill);
      background: var(--cog-success);
    }

    .share-dialog__live-text {
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-body-sm);
      line-height: var(--cog-lh-body-sm);
    }

    .share-dialog__link-group {
      display: grid;
      gap: var(--cog-space-075);
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

    .share-dialog__url-wrap {
      display: flex;
      flex: 1;
      min-width: 0;
      align-items: center;
      gap: var(--cog-space-075);
      min-height: 40px;
      border: 1px solid var(--cog-border);
      border-radius: var(--cog-radius-sm);
      background: var(--cog-input-bg);
      padding: 0 var(--cog-space-150);
    }

    .share-dialog__url-icon {
      flex: none;
    }

    .share-dialog__url {
      flex: 1;
      min-width: 0;
      border: 0;
      background: transparent;
      color: var(--cog-text);
      padding: 0;
      font: inherit;
      outline: 0;
    }

    .share-dialog__modes {
      display: grid;
      gap: var(--cog-space-150);
      margin: 0;
      padding: 0;
      border: 0;
    }

    .share-dialog__modes .share-dialog__overline {
      margin-bottom: var(--cog-space-050);
    }

    /* Selectable option cards. The whole card is the label so clicking anywhere
       selects the mode; the tone shifts to signal selection (green = safe,
       red = higher risk). */
    .share-dialog__mode {
      display: flex;
      gap: var(--cog-space-150);
      align-items: flex-start;
      padding: var(--cog-space-150);
      border: 1px solid var(--cog-border);
      border-radius: var(--cog-radius-md);
      cursor: pointer;
      transition:
        border-color var(--cog-dur-fast) var(--cog-ease-standard),
        background-color var(--cog-dur-fast) var(--cog-ease-standard);
    }

    .share-dialog__mode:hover {
      border-color: var(--cog-border-bold);
    }

    .share-dialog__mode--selected {
      border-color: var(--cog-success);
      background: var(--cog-success-bg);
    }

    .share-dialog__mode--danger {
      border-color: var(--cog-danger-border);
      background: var(--cog-danger-bg);
    }

    .share-dialog__mode input[type='radio'] {
      margin: var(--cog-space-025) 0 0;
      flex: none;
      accent-color: var(--cog-brand);
    }

    .share-dialog__mode-text {
      display: grid;
      gap: var(--cog-space-050);
    }

    .share-dialog__mode-heading {
      display: flex;
      flex-wrap: wrap;
      align-items: center;
      gap: var(--cog-space-100);
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
  // The effective mode of the live share (server-authoritative). Drives the
  // "Live" status copy in the shared state.
  readonly sharedMode = signal<PublicShareMode>('redacted_only');

  ngOnInit(): void {
    const conversation = this._conversationService.getConversation(
      this.data.conversationId,
    )();

    if (!conversation) {
      this.state.set('idle');
      return;
    }

    this._publicShareService
      .existingShare(conversation)
      .pipe(
        catchError(() => {
          // Treat a lookup failure as "not shared yet" so the user can still
          // create a link rather than getting stuck on an error.
          this.state.set('idle');
          return EMPTY;
        }),
      )
      .subscribe((share) => {
        if (share) {
          this.shareUrl.set(share.url);
          this.sharedMode.set(share.mode);
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
      .subscribe((share) => {
        this.shareUrl.set(share.url);
        this.sharedMode.set(share.mode);
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
        this.sharedMode.set('redacted_only');
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
