import { Component, OnInit, inject } from '@angular/core';
import {
  AbstractControl,
  FormControl,
  FormGroup,
  ReactiveFormsModule,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';

import { EMPTY, catchError, finalize } from 'rxjs';

import { ConversationData } from '@app/interfaces/conversation';
import { ConversationService } from '@app/services/conversation.service';
import { DeviceService } from '@app/services/device.service';
import { ErrorService } from '@app/services/error.service';

import { expiringDurations } from '../chat/temporary-message-dialog/temporary-message-dialog.component';

/**
 * A custom validator that checks if the input is not blank after trimming (i.e. it is not just whitespace)
 *
 * @returns
 */
const notBlankValidator = (): ValidatorFn => {
  return (control: AbstractControl): ValidationErrors | null => {
    const isBlank = (control.value || '').trim().length === 0;
    const isValid = !isBlank;
    return isValid ? null : { blank: true };
  };
};

@Component({
  selector: 'app-edit-conversation-dialog',
  standalone: true,
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatInputModule,
    MatFormFieldModule,
    ReactiveFormsModule,
    MatButtonToggleModule,
  ],
  template: `<h2 mat-dialog-title="">Edit conversation</h2>
    <mat-dialog-content>
      <form
        (submit)="onEditConversation()"
        [id]="formId"
        [formGroup]="editForm"
        class="prose flex flex-col text-balance prose-headings:mb-2 prose-headings:mt-4 prose-p:mb-2"
      >
        <h3>Change the name</h3>
        <mat-form-field class="w-full"
          ><input type="text" matInput="" formControlName="title"
        /></mat-form-field>
        <h3>Enable temporary messages</h3>
        <p>
          For more privacy all new messages will disappear from this chat after the
          selected duration below. You can also choose to manually keep a message that's
          due to be deleted before it expires.
        </p>
        <p>This will not affect existing messages and can be disabled at any time.</p>
        <div class="text-center">
          <mat-button-toggle-group
            formControlName="expirationDuration"
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
      </form>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button="" mat-dialog-close="" color="secondary">Cancel</button>
      <button
        mat-button=""
        type="submit"
        color="primary"
        [attr.form]="formId"
        [disabled]="editForm.disabled || !editForm.valid"
      >
        Save
      </button>
    </mat-dialog-actions> `,
  styles: `
    mat-button-toggle-group.less-rounded {
      --mat-standard-button-toggle-shape: 20px;
    }
  `,
})
export class EditConversationDialogComponent implements OnInit {
  private readonly _dialogRef: MatDialogRef<EditConversationDialogComponent> = inject(
    MatDialogRef<EditConversationDialogComponent>,
  );
  private readonly _errorService = inject(ErrorService);

  readonly conversationService = inject(ConversationService);
  readonly deviceService = inject(DeviceService);

  readonly expiringDurations = expiringDurations;
  readonly data: { conversationId: string } = inject(MAT_DIALOG_DATA);

  editForm = new FormGroup({
    title: new FormControl('', [Validators.required, notBlankValidator()]),
    expirationDuration: new FormControl(''),
  });

  /**
   * formId - the id of the form element in the template
   */
  get formId() {
    return `edit-${this.data.conversationId}`;
  }

  onEditConversation() {
    this.editForm.disable();
    const data: ConversationData = {
      title: this.editForm.value.title ?? '',
    };

    this.conversationService
      .editConversation(this.data.conversationId, data)
      .pipe(
        finalize(() => this.editForm.enable()),
        catchError((error) => {
          this._errorService.alert(
            'Unable to edit conversation, please try again later',
          );
          console.error('Failed to edit conversation', error);
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this._dialogRef.close();
      });
  }

  ngOnInit(): void {
    const conversation = this.conversationService.getConversation(
      this.data.conversationId,
    )();

    if (conversation) {
      this.editForm.setValue({
        title: conversation.decryptedData.title,
        expirationDuration: conversation.record.expiry_duration,
      });
    }
  }
}
