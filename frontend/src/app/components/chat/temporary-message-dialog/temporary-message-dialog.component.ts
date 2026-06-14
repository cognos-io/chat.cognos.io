import { DialogRef } from '@angular/cdk/dialog';
import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';

import {
  CognosButtonComponent,
  CognosDialogSurfaceComponent,
} from '@cognos/ui-angular';

import { Conversation } from '@app/interfaces/conversation';
import { ConversationService } from '@app/services/conversation.service';
import { ConversationsExpiryDurationOptions } from '@app/types/pocketbase-types';

export const expiringDurations = [
  { value: '', label: 'Off' },
  { value: '24h', label: '24 hours' },
  { value: '168h', label: '7 days' },
  { value: '2160h', label: '90 days' },
  { value: '4320h', label: '180 days' },
];

@Component({
  selector: 'app-temporary-message-dialog',
  standalone: true,
  imports: [ReactiveFormsModule, CognosDialogSurfaceComponent, CognosButtonComponent],
  template: `
    <cog-dialog-surface
      title="Disappearing messages"
      [footer]="true"
      [width]="560"
      (close)="close()"
    >
      <div class="temporary-message-dialog">
        <div class="temporary-message-dialog__copy">
          <p>Make your messages disappear.</p>
          <p>
            For more privacy all new messages will disappear from this chat after the
            selected duration below. You can also manually keep a message before it
            expires.
          </p>
          <p>This will not affect existing messages and can be disabled at any time.</p>
        </div>

        <div class="temporary-message-dialog__options" role="radiogroup">
          @for (option of expiringDurations; track option.label) {
            <button
              [class]="optionClass(option.value)"
              type="button"
              (click)="expirationDuration.setValue(option.value)"
            >
              {{ option.label }}
            </button>
          }
        </div>
      </div>

      <div cogDialogFooter>
        <cog-button appearance="subtle" (click)="close()">Cancel</cog-button>
        <cog-button appearance="primary" (click)="onSave()">Save</cog-button>
      </div>
    </cog-dialog-surface>
  `,
  styles: `
    .temporary-message-dialog {
      display: grid;
      gap: var(--cog-space-200);
    }

    .temporary-message-dialog__copy {
      display: grid;
      gap: var(--cog-space-100);
      color: var(--cog-text);
      font-size: var(--cog-fs-body);
      line-height: var(--cog-lh-body);
    }

    .temporary-message-dialog__copy p {
      margin: 0;
    }

    .temporary-message-dialog__options {
      display: flex;
      flex-wrap: wrap;
      gap: var(--cog-space-100);
    }

    .temporary-message-dialog__option {
      min-height: 40px;
      border: 1px solid var(--cog-border);
      border-radius: var(--cog-radius-sm);
      background: var(--cog-surface);
      color: var(--cog-text);
      padding: 0 var(--cog-space-150);
      font: inherit;
      cursor: pointer;
      transition:
        background-color var(--cog-dur-fast) var(--cog-ease-standard),
        border-color var(--cog-dur-fast) var(--cog-ease-standard),
        color var(--cog-dur-fast) var(--cog-ease-standard);
    }

    .temporary-message-dialog__option:hover {
      background: var(--cog-surface-hover);
    }

    .temporary-message-dialog__option--selected {
      border-color: var(--cog-selected-border);
      background: var(--cog-selected-bg);
      color: var(--cog-selected-text);
      font-weight: var(--cog-fw-semibold);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TemporaryMessageDialogComponent {
  private readonly _conversationService = inject(ConversationService);
  private readonly _dialogRef = inject(DialogRef<string | null>);

  readonly expiringDurations = expiringDurations;
  readonly conversation = input<Conversation>();
  readonly expirationDuration = new FormControl<string>(
    (this.conversation()?.record.expiry_duration as string) ??
      this._conversationService.expirationDuration(),
    { nonNullable: true },
  );

  close() {
    this._dialogRef.close(null);
  }

  onSave() {
    const expirationDuration = this.expirationDuration.value ?? '';

    this._conversationService.setExpirationDuration({
      id: this.conversation()?.record.id ?? '-1',
      expirationDuration: isValidExpirationDuration(expirationDuration)
        ? (expirationDuration as ConversationsExpiryDurationOptions)
        : undefined,
    });

    this._dialogRef.close(expirationDuration);
  }

  optionClass(value: string) {
    return this.expirationDuration.value === value
      ? 'temporary-message-dialog__option temporary-message-dialog__option--selected'
      : 'temporary-message-dialog__option';
  }
}

const isValidExpirationDuration = (value: string): boolean => {
  return value in ConversationsExpiryDurationOptions;
};
