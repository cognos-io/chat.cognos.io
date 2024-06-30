import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { FormControl } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDialogModule } from '@angular/material/dialog';

import { Conversation } from '@app/interfaces/conversation';
import { DeviceService } from '@app/services/device.service';

@Component({
  selector: 'app-temporary-message-dialog',
  standalone: true,
  imports: [MatDialogModule, MatButtonToggleModule, MatButtonModule],
  template: ` <h2 mat-dialog-title="">Disappearing messages</h2>
    <mat-dialog-content>
      <div class="flex flex-col gap-4">
        <div class="prose">
          <p>Make your messages disappear.</p>
          <p>
            For more privacy all new messages will disappear from this chat after the
            selected duration below. You can also choose to manually keep a message
            that's due to be deleted before it expires.
          </p>
          <p>This will not affect existing messages and can be disabled at any time.</p>
        </div>
        <mat-button-toggle-group
          name="favoriteColor"
          aria-label="Favorite Color"
          class="less-rounded justify-center"
          [vertical]="deviceService.isMobile()"
        >
          @for (option of expiringDurations; track option.label) {
            <mat-button-toggle [value]="option.value">{{
              option.label
            }}</mat-button-toggle>
          }
        </mat-button-toggle-group>
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close color="error">Cancel</button>
      <button mat-button [mat-dialog-close]="true" cdkFocusInitial>Save</button>
    </mat-dialog-actions>`,
  styles: `
    mat-button-toggle-group.less-rounded {
      --mat-standard-button-toggle-shape: 20px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TemporaryMessageDialogComponent {
  public readonly deviceService = inject(DeviceService);

  public readonly expiringDurations = [
    { value: '', label: 'Off' },
    { value: '24h', label: '24 hours' },
    { value: '168h', label: '7 days' },
    { value: '2160h', label: '90 days' },
    { value: '4320h', label: '180 days' },
  ];

  public readonly conversation = input<Conversation>();
  public readonly expirationDurationControl = new FormControl(
    this.conversation()?.record.expiryDuration ?? '',
  );
}
