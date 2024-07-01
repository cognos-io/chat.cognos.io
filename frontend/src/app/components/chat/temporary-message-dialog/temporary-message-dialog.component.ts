import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { FormControl, ReactiveFormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';

import { Conversation } from '@app/interfaces/conversation';
import { ConversationService } from '@app/services/conversation.service';
import { DeviceService } from '@app/services/device.service';
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
  imports: [
    MatDialogModule,
    MatButtonToggleModule,
    MatButtonModule,
    ReactiveFormsModule,
  ],
  template: ` <h2 mat-dialog-title="">Disappearing messages</h2>
    <mat-dialog-content>
      <div class="flex flex-col gap-4">
        <div class="prose prose-headings:mb-2 prose-headings:mt-4 prose-p:mb-2">
          <p>Make your messages disappear.</p>
          <p>
            For more privacy all new messages will disappear from this chat after the
            selected duration below. You can also choose to manually keep a message
            that's due to be deleted before it expires.
          </p>
          <p>This will not affect existing messages and can be disabled at any time.</p>
        </div>

        <div class="text-center">
          <mat-button-toggle-group
            [formControl]="expirationDuration"
            name="favoriteColor"
            aria-label="Favorite Color"
            class="less-rounded w-full justify-center lg:w-auto"
            [vertical]="deviceService.isMobile()"
          >
            @for (option of expiringDurations; track option.label) {
              <mat-button-toggle [value]="option.value">{{
                option.label
              }}</mat-button-toggle>
            }
          </mat-button-toggle-group>
        </div>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close color="error">Cancel</button>
      <button (click)="onSave()" mat-button cdkFocusInitial>Save</button>
    </mat-dialog-actions>`,
  styles: `
    mat-button-toggle-group.less-rounded {
      --mat-standard-button-toggle-shape: 20px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TemporaryMessageDialogComponent {
  private readonly _conversationService = inject(ConversationService);

  public readonly deviceService = inject(DeviceService);

  public readonly expiringDurations = expiringDurations;

  public readonly conversation = input<Conversation>();
  public readonly expirationDuration = new FormControl(
    (this.conversation()?.record
      .expiry_duration as keyof typeof ConversationsExpiryDurationOptions) ??
      this._conversationService.expirationDuration(),
  );

  constructor(private _dialogRef: MatDialogRef<TemporaryMessageDialogComponent>) {}

  onSave() {
    const expirationDuration = this.expirationDuration.value ?? '';

    this._conversationService.setExpirationDuration({
      id: this.conversation()?.record.id ?? '-1',
      expirationDuration: isValidExpirationDuration(expirationDuration)
        ? (expirationDuration as ConversationsExpiryDurationOptions)
        : undefined,
    });

    this._dialogRef.close(this.expirationDuration.value);
  }
}

const isValidExpirationDuration = (value: string): boolean => {
  return value in ConversationsExpiryDurationOptions;
};
