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
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef,
} from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';

import { EMPTY, catchError } from 'rxjs';

import { ConversationData } from '@app/interfaces/conversation';
import { ConversationService } from '@app/services/conversation.service';

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
  ],
  template: `<h2 mat-dialog-title="">Edit conversation</h2>
    <mat-dialog-content>
      <p>Enter the new name for your conversation</p>
      <form (submit)="onEditConversation()" [id]="formId" [formGroup]="editForm">
        <mat-form-field class="w-full"
          ><input type="text" matInput="" formControlName="title"
        /></mat-form-field>
      </form>
      <mat-dialog-actions align="end">
        <button mat-button="" mat-dialog-close="" color="secondary">Cancel</button>
        <button
          mat-button=""
          mat-dialog-close=""
          type="submit"
          color="primary"
          [attr.form]="formId"
        >
          Save
        </button>
      </mat-dialog-actions>
    </mat-dialog-content> `,
  styles: ``,
})
export class EditConversationDialogComponent implements OnInit {
  private readonly dialogRef: MatDialogRef<EditConversationDialogComponent> = inject(
    MatDialogRef<EditConversationDialogComponent>,
  );

  readonly conversationService = inject(ConversationService);

  readonly data: { conversationId: string } = inject(MAT_DIALOG_DATA);

  editForm = new FormGroup({
    title: new FormControl('', [Validators.required, notBlankValidator()]),
  });

  /**
   * formId - the id of the form element in the template
   */
  get formId() {
    return `edit-${this.data.conversationId}`;
  }

  onEditConversation() {
    const data: ConversationData = {
      title: this.editForm.value.title ?? '',
    };

    this.conversationService
      .editConversation(this.data.conversationId, data)
      .pipe(
        catchError((error) => {
          console.error('Failed to edit conversation', error);
          return EMPTY;
        }),
      )
      .subscribe(() => {
        this.dialogRef.close();
      });
  }

  ngOnInit(): void {
    const conversation = this.conversationService.getConversation(
      this.data.conversationId,
    )();

    if (conversation) {
      this.editForm.setValue({ title: conversation.decryptedData.title });
    }
  }
}
