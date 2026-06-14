import { DIALOG_DATA, DialogRef } from '@angular/cdk/dialog';
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

import { EMPTY, catchError, finalize } from 'rxjs';

import {
  CognosButtonComponent,
  CognosDialogSurfaceComponent,
} from '@cognos/ui-angular';

import { ConversationData } from '@app/interfaces/conversation';
import { ConversationService } from '@app/services/conversation.service';
import { ErrorService } from '@app/services/error.service';

import { expiringDurations } from '../chat/temporary-message-dialog/temporary-message-dialog.component';

const notBlankValidator = (): ValidatorFn => {
  return (control: AbstractControl): ValidationErrors | null => {
    const isBlank = (control.value || '').trim().length === 0;
    return isBlank ? { blank: true } : null;
  };
};

@Component({
  selector: 'app-edit-conversation-dialog',
  standalone: true,
  imports: [ReactiveFormsModule, CognosDialogSurfaceComponent, CognosButtonComponent],
  template: `
    <cog-dialog-surface
      title="Edit conversation"
      [footer]="true"
      [width]="560"
      (close)="close()"
    >
      <form [formGroup]="editForm" [id]="formId" class="edit-conversation-dialog">
        <div class="edit-conversation-dialog__field">
          <label class="edit-conversation-dialog__label" for="conversation-title">
            Change the name
          </label>
          <input
            id="conversation-title"
            class="edit-conversation-dialog__input"
            formControlName="title"
            type="text"
          />
        </div>

        <div class="edit-conversation-dialog__copy">
          <h3>Enable disappearing messages</h3>
          <p>
            For more privacy all new messages will disappear from this chat after the
            selected duration below. You can also choose to manually keep a message
            before it expires.
          </p>
          <p>This will not affect existing messages and can be disabled at any time.</p>
        </div>

        <div class="edit-conversation-dialog__options" role="radiogroup">
          @for (option of expiringDurations; track option.label) {
            <button
              [class]="optionClass(option.value)"
              type="button"
              (click)="editForm.controls.expirationDuration.setValue(option.value)"
            >
              {{ option.label }}
            </button>
          }
        </div>
      </form>

      <div cogDialogFooter>
        <cog-button appearance="subtle" (click)="close()">Cancel</cog-button>
        <cog-button
          appearance="primary"
          type="submit"
          [disabled]="editForm.disabled || !editForm.valid"
          [attr.form]="formId"
          (click)="onEditConversation()"
        >
          Save
        </cog-button>
      </div>
    </cog-dialog-surface>
  `,
  styles: `
    .edit-conversation-dialog {
      display: grid;
      gap: var(--cog-space-200);
    }

    .edit-conversation-dialog__field,
    .edit-conversation-dialog__copy {
      display: grid;
      gap: var(--cog-space-100);
    }

    .edit-conversation-dialog__label,
    .edit-conversation-dialog__copy h3 {
      color: var(--cog-text);
      font-size: var(--cog-fs-h-sm);
      font-weight: var(--cog-fw-h-sm);
      line-height: var(--cog-lh-h-sm);
    }

    .edit-conversation-dialog__copy p,
    .edit-conversation-dialog__copy h3 {
      margin: 0;
    }

    .edit-conversation-dialog__copy p {
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-body);
      line-height: var(--cog-lh-body);
    }

    .edit-conversation-dialog__input {
      min-height: 40px;
      border: 2px solid var(--cog-border);
      border-radius: var(--cog-radius-sm);
      background: var(--cog-input-bg);
      color: var(--cog-text);
      padding: 0 var(--cog-space-150);
      font: inherit;
      outline: 0;
    }

    .edit-conversation-dialog__input:focus {
      border-color: var(--cog-brand);
      background: var(--cog-input-bg-focus);
    }

    .edit-conversation-dialog__options {
      display: flex;
      flex-wrap: wrap;
      gap: var(--cog-space-100);
    }

    .edit-conversation-dialog__option {
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

    .edit-conversation-dialog__option:hover {
      background: var(--cog-surface-hover);
    }

    .edit-conversation-dialog__option--selected {
      border-color: var(--cog-selected-border);
      background: var(--cog-selected-bg);
      color: var(--cog-selected-text);
      font-weight: var(--cog-fw-semibold);
    }
  `,
})
export class EditConversationDialogComponent implements OnInit {
  private readonly _dialogRef = inject(DialogRef<void>);
  private readonly _errorService = inject(ErrorService);

  readonly conversationService = inject(ConversationService);
  readonly expiringDurations = expiringDurations;
  readonly data: { conversationId: string } = inject(DIALOG_DATA);

  editForm = new FormGroup({
    title: new FormControl('', [Validators.required, notBlankValidator()]),
    expirationDuration: new FormControl(''),
  });

  get formId() {
    return `edit-${this.data.conversationId}`;
  }

  close() {
    this._dialogRef.close();
  }

  onEditConversation() {
    if (this.editForm.invalid || this.editForm.disabled) {
      return;
    }

    this.editForm.disable();
    const data: ConversationData = {
      title: this.editForm.value.title ?? '',
    };

    const expirationDuration = this.editForm.value.expirationDuration ?? '';

    this.conversationService
      .editConversation(this.data.conversationId, expirationDuration, data)
      .pipe(
        finalize(() => this.editForm.enable()),
        catchError(() => {
          this._errorService.alert(
            'Unable to edit conversation, please try again later.',
          );
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this._dialogRef.close();
      });
  }

  optionClass(value: string) {
    return this.editForm.controls.expirationDuration.value === value
      ? 'edit-conversation-dialog__option edit-conversation-dialog__option--selected'
      : 'edit-conversation-dialog__option';
  }

  ngOnInit(): void {
    const conversation = this.conversationService.getConversation(
      this.data.conversationId,
    )();

    if (conversation) {
      this.editForm.setValue({
        title: conversation.decryptedData.title,
        expirationDuration: conversation.record.expiry_duration ?? '',
      });
    }
  }
}
