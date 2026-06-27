import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';

import { CognosIconComponent } from '@cognos/ui-angular';

/**
 * One user-upload attachment as it appears inside a message bubble. The state
 * captures what the *current viewer* can see (spec docs/specs/attachments.md):
 *   - resolved: the viewer owns the file → name + click-to-download;
 *   - removed:  the owner deleted it from their library → "File removed";
 *   - private:  another participant's file the viewer can't decrypt → "Private
 *     file attached" (the file is sealed to its owner's key).
 */
export interface MessageAttachmentChip {
  attachmentId: string;
  state: 'resolved' | 'removed' | 'private';
  fileName?: string;
  /** Server file name of the original artifact, for the download fetch. */
  originalFileName?: string;
  /** base64 secretbox key for the original artifact, from the decrypted manifest. */
  originalKeyB64?: string;
  mimeType?: string;
}

/**
 * Renders a single attachment chip in a message bubble. Dumb/presentational: it
 * emits (download) for resolved chips and the parent performs the fetch+decrypt.
 */
@Component({
  selector: 'app-message-attachment-chip',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [TranslocoModule, CognosIconComponent],
  template: `
    <ng-container *transloco="let t">
      @if (chip().state === 'resolved') {
        <button
          type="button"
          class="message-attachment-chip"
          data-testid="message-attachment-chip"
          [attr.aria-label]="
            t('chat.message.attachment.download', { name: chip().fileName })
          "
          (click)="download.emit(chip())"
        >
          <span class="message-attachment-chip__icon">
            <cog-icon name="file-text" [size]="18" tone="text-subtle" />
          </span>
          <span class="message-attachment-chip__body">
            <span class="message-attachment-chip__name">{{ chip().fileName }}</span>
            <span class="message-attachment-chip__subtitle">{{
              t('chat.message.attachment.subtitleDocument')
            }}</span>
          </span>
        </button>
      } @else {
        <div
          class="message-attachment-chip message-attachment-chip--muted"
          [attr.data-testid]="
            chip().state === 'removed'
              ? 'message-attachment-tombstone'
              : 'message-attachment-private'
          "
        >
          <span class="message-attachment-chip__icon">
            <cog-icon name="file-text" [size]="18" tone="text-subtle" />
          </span>
          <span class="message-attachment-chip__body">
            <span class="message-attachment-chip__name">{{
              chip().state === 'removed'
                ? t('chat.message.attachment.removed')
                : t('chat.message.attachment.private')
            }}</span>
          </span>
        </div>
      }
    </ng-container>
  `,
  styles: [
    `
      :host {
        display: block;
      }
      .message-attachment-chip {
        display: inline-flex;
        align-items: center;
        gap: 0.5rem;
        max-width: 100%;
        padding: 0.5rem 0.75rem;
        border: 1px solid var(--cog-color-border, rgba(0, 0, 0, 0.1));
        border-radius: 0.625rem;
        background: var(--cog-color-surface, rgba(0, 0, 0, 0.03));
        font: inherit;
        text-align: left;
        cursor: pointer;
      }
      button.message-attachment-chip:hover {
        background: var(--cog-color-surface-hover, rgba(0, 0, 0, 0.06));
      }
      .message-attachment-chip--muted {
        cursor: default;
        opacity: 0.7;
      }
      .message-attachment-chip__icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 2rem;
        height: 2rem;
        border-radius: 0.5rem;
        background: var(--cog-color-accent-subtle, rgba(59, 130, 246, 0.12));
        flex: none;
      }
      .message-attachment-chip__body {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }
      .message-attachment-chip__name {
        font-weight: 600;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .message-attachment-chip__subtitle {
        font-size: 0.8125rem;
        color: var(--cog-color-text-subtle, rgba(0, 0, 0, 0.55));
      }
    `,
  ],
})
export class MessageAttachmentChipComponent {
  readonly chip = input.required<MessageAttachmentChip>();
  readonly download = output<MessageAttachmentChip>();
}
