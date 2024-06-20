import { isPlatformBrowser } from '@angular/common';
import { Component, PLATFORM_ID, computed, effect, inject } from '@angular/core';
import {
  FormBuilder,
  FormControl,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { ErrorStateMatcher } from '@angular/material/core';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';

import { AgentService } from '@app/services/agent.service';
import { ConversationService } from '@app/services/conversation.service';
import { DeviceService } from '@app/services/device.service';
import {
  MessageRequest,
  MessageService,
  MessageStatus,
} from '@app/services/message.service';
import { ModelService } from '@app/services/model.service';

import { AgentSelectorComponent } from './agent-selector/agent-selector.component';
import { ModelSelectorComponent } from './model-selector/model-selector.component';

/** Error when invalid control is touched. */
export class TouchedErrorStateMatcher implements ErrorStateMatcher {
  isErrorState(control: FormControl | null): boolean {
    return !!(
      control &&
      control.invalid &&
      control.dirty &&
      (control.value || '').trim().length > 0
    );
  }
}

@Component({
  selector: 'app-message-form',
  standalone: true,
  imports: [
    MatButtonModule,
    ReactiveFormsModule,
    MatInputModule,
    MatIconModule,
    MatDialogModule,
    MatTooltipModule,
  ],
  template: `
    <form class="message-form gap-2" [formGroup]="messageForm" (submit)="sendMessage()">
      <mat-form-field class="flex-grow">
        <mat-label>Chat to an AI</mat-label>
        <textarea
          formControlName="content"
          cdkTextareaAutosize
          name="message-form"
          id="message-form"
          matInput
          [errorStateMatcher]="errorStateMatcher"
          placeholder="Teach me about..."
          (keydown.control.enter)="isMac ? undefined : sendMessage()"
          (keydown.meta.enter)="isMac ? sendMessage() : undefined"
        ></textarea>
        @if (canClearTemporaryMessages() && !isMobile()) {
          <button
            mat-icon-button
            matPrefix
            matTooltip="Clears all messages. Unrecoverable."
            (click)="onClearMessages()"
          >
            <mat-icon fontSet="bi" fontIcon="bi-fire"></mat-icon>
          </button>
        }
        @if (messageForm.valid) {
          <button type="submit" matSuffix mat-icon-button="">
            <mat-icon fontSet="bi" fontIcon="bi-send-fill"></mat-icon>
          </button>
        }
      </mat-form-field>
    </form>

    <div class="flex flex-col justify-between md:flex-row md:items-center">
      <span class="hidden italic md:block">
        @if (isMac) {
          Cmd
        } @else {
          Ctrl
        }
        + Enter to send</span
      >
      <div class="flex flex-col items-center md:flex-row">
        <div class="flex items-center">
          <button class="inline-button" mat-button (click)="openAgentSelector()">
            {{ agentService.selectedAgent().name }}
          </button>
        </div>
        <div class="flex items-center">
          <span class="mx-2 italic">powered by</span>
          <button class="inline-button" mat-button (click)="openModelSelector()">
            {{ modelService.selectedModel().name }}
          </button>
        </div>
      </div>
    </div>
  `,
  styles: `
    .message-form {
      width: 100%;

      display: flex;
    }

    .inline-button {
      --mdc-text-button-container-height: 20px;
    }
  `,
})
export class MessageFormComponent {
  private _fb = inject(FormBuilder);
  private _dialog = inject(MatDialog);
  private _platformId = inject(PLATFORM_ID);
  private readonly _conversationService = inject(ConversationService);
  private readonly _deviceService = inject(DeviceService);

  private _previousMessage = '';

  isMac = false;
  isMobile = computed(() => this._deviceService.isMobile());

  public readonly errorStateMatcher = new TouchedErrorStateMatcher();

  public readonly messageService = inject(MessageService);
  public readonly agentService = inject(AgentService);
  public readonly modelService = inject(ModelService);

  messageForm = this._fb.group({
    content: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
  });

  constructor() {
    if (isPlatformBrowser(this._platformId)) {
      this.isMac = window.navigator.userAgent.includes('Mac');
    }

    effect(() => {
      switch (this.messageService.status()) {
        case MessageStatus.Sending:
          this.disableForm();
          break;
        case MessageStatus.Success:
          this._previousMessage = '';
          this.enableForm();
          break;
        case MessageStatus.None:
        case MessageStatus.ErrorSending:
          this.messageForm.patchValue({ content: this._previousMessage });
          this.enableForm();
          break;
      }
    });
  }

  openAgentSelector() {
    this._dialog.open(AgentSelectorComponent);
  }

  openModelSelector() {
    this._dialog.open(ModelSelectorComponent, {});
  }

  sendMessage() {
    const content = this.messageForm.get('content');
    if (content) {
      this._previousMessage = content.value;
      const messageRequest: MessageRequest = {
        content: content.value,
        requestId: self.crypto.randomUUID(),
      };
      this.messageService.sendMessage$.next(messageRequest);
      this.messageForm.reset();
    }
  }

  disableForm() {
    this.messageForm.disable();
  }

  enableForm() {
    this.messageForm.enable();
  }

  canClearTemporaryMessages = computed(() => {
    return (
      this._conversationService.isTemporaryConversation() &&
      this.messageService.messages().length > 0
    );
  });

  onClearMessages() {
    this.messageService.resetState();
  }
}
