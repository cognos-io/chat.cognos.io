import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  inject,
  signal,
} from '@angular/core';

import { EMPTY, catchError, finalize } from 'rxjs';

import {
  CognosButtonComponent,
  CognosDialogSurfaceComponent,
} from '@cognos/ui-angular';

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
  imports: [CognosDialogSurfaceComponent, CognosButtonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <cog-dialog-surface
      title="Share conversation"
      [footer]="true"
      [width]="560"
      (close)="close()"
    >
      <div class="share-dialog">
        @switch (state()) {
          @case ('checking') {
            <p class="share-dialog__status">Checking sharing status…</p>
          }
          @case ('idle') {
            <div class="share-dialog__copy">
              <h3>Create a public link</h3>
              <p>
                Anyone with the link can read this conversation. The decryption key
                lives in the link itself and never reaches our servers — so keep the
                link private to the people you choose.
              </p>
            </div>
          }
          @case ('shared') {
            <div class="share-dialog__copy">
              <h3>Public link</h3>
              <p>Anyone with this link can read the conversation.</p>
            </div>
            <div class="share-dialog__link">
              <input
                class="share-dialog__url"
                type="text"
                readonly
                [value]="shareUrl()"
                (focus)="selectAll($event)"
                aria-label="Public share link"
              />
              <cog-button appearance="default" (click)="copy()">
                {{ copied() ? 'Copied' : 'Copy' }}
              </cog-button>
            </div>
          }
        }
      </div>

      <div cogDialogFooter>
        <cog-button appearance="subtle" (click)="close()">Close</cog-button>
        @if (state() === 'idle') {
          <cog-button
            appearance="primary"
            [disabled]="working()"
            (click)="createLink()"
          >
            Create public link
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
  `,
})
export class ShareConversationDialogComponent implements OnInit {
  private readonly _dialogRef = inject(DialogRef<void>);
  private readonly _conversationService = inject(ConversationService);
  private readonly _publicShareService = inject(PublicShareService);
  private readonly _errorService = inject(ErrorService);

  readonly data: { conversationId: string } = inject(DIALOG_DATA);

  readonly state = signal<ShareState>('checking');
  readonly shareUrl = signal('');
  readonly copied = signal(false);
  readonly working = signal(false);

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
      .share(conversation)
      .pipe(
        finalize(() => this.working.set(false)),
        catchError(() => {
          this._errorService.alert('Unable to create a public link, please try again.');
          return EMPTY;
        }),
      )
      .subscribe((url) => {
        this.shareUrl.set(url);
        this.state.set('shared');
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
      .catch(() => this._errorService.alert('Unable to copy the link.'));
  }

  selectAll(event: FocusEvent): void {
    (event.target as HTMLInputElement | null)?.select();
  }

  close(): void {
    this._dialogRef.close();
  }
}
