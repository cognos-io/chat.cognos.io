import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

import { TranslocoModule } from '@jsverse/transloco';

import { CognosDocAttachmentComponent, CognosIconComponent } from '@cognos/ui-angular';

/**
 * One user-upload attachment as it appears inside a message bubble. The state
 * captures what the *current viewer* can see (docs/business_processes/attachment-processing.md):
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
  imports: [TranslocoModule, CognosIconComponent, CognosDocAttachmentComponent],
  template: `
    <ng-container *transloco="let t">
      @if (chip().state === 'resolved') {
        <cog-doc-attachment
          data-testid="message-attachment-chip"
          [name]="chip().fileName ?? ''"
          [meta]="t('chat.message.attachment.subtitleDocument')"
          [clickable]="true"
          [showEncrypted]="false"
          (open)="download.emit(chip())"
        />
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
      /* The resolved file now renders via cog-doc-attachment; these styles
         cover only the muted tombstone/private states below. */
      .message-attachment-chip--muted {
        display: inline-flex;
        align-items: center;
        gap: var(--cog-space-100);
        max-width: 100%;
        padding: var(--cog-space-100) var(--cog-space-150);
        border: var(--cog-border-width) solid var(--cog-border);
        border-radius: var(--cog-radius-sm);
        background: var(--cog-surface-sunken);
        opacity: 0.7;
      }
      .message-attachment-chip__icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: var(--cog-space-400);
        height: var(--cog-space-400);
        border-radius: var(--cog-radius-sm);
        background: var(--cog-surface-sunken);
        flex: none;
      }
      .message-attachment-chip__body {
        display: flex;
        flex-direction: column;
        min-width: 0;
      }
      .message-attachment-chip__name {
        font-weight: var(--cog-fw-semibold);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
    `,
  ],
})
export class MessageAttachmentChipComponent {
  readonly chip = input.required<MessageAttachmentChip>();
  readonly download = output<MessageAttachmentChip>();
}
