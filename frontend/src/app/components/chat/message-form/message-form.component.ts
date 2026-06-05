import { Dialog } from '@angular/cdk/dialog';
import { CdkTextareaAutosize } from '@angular/cdk/text-field';
import { isPlatformBrowser } from '@angular/common';
import { Component, PLATFORM_ID, computed, effect, inject } from '@angular/core';
import {
  FormBuilder,
  FormControl,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';

import {
  CognosButtonComponent,
  CognosIconButtonComponent,
  CognosIconComponent,
} from '@cognos/ui-angular';

import { AgentService } from '@app/services/agent.service';
import { ConversationService } from '@app/services/conversation.service';
import { DeviceService } from '@app/services/device.service';
import {
  MessageRequest,
  MessageService,
  MessageStatus,
} from '@app/services/message.service';
import { ModelService } from '@app/services/model.service';
import { cognosDialogOptions } from '@app/utils/dialog-options';

import { AgentSelectorComponent } from './agent-selector/agent-selector.component';
import { ModelSelectorComponent } from './model-selector/model-selector.component';

@Component({
  selector: 'app-message-form',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    CdkTextareaAutosize,
    CognosButtonComponent,
    CognosIconButtonComponent,
    CognosIconComponent,
  ],
  template: `
    <form class="message-form" [formGroup]="messageForm" (submit)="sendMessage()">
      <div class="message-form__panel">
        <label class="message-form__label" for="message-form">
          Message Cognos — encrypted on this device
        </label>

        <textarea
          cdkTextareaAutosize
          cdkAutosizeMaxRows="8"
          cdkAutosizeMinRows="2"
          class="message-form__textarea"
          formControlName="content"
          id="message-form"
          name="message-form"
          placeholder="Teach me about..."
          (keydown.control.enter)="isMac ? undefined : sendMessage()"
          (keydown.meta.enter)="isMac ? sendMessage() : undefined"
        ></textarea>

        <div class="message-form__controls">
          <cog-button
            appearance="default"
            iconAfter="chevron-down"
            type="button"
            (click)="openAgentSelector()"
          >
            {{ agentService.selectedAgent().name }}
          </cog-button>

          <span class="message-form__powered-by">powered by</span>

          <cog-button
            appearance="default"
            iconAfter="chevron-down"
            type="button"
            (click)="openModelSelector()"
          >
            {{ modelService.selectedModel().name }}
          </cog-button>

          @if (canClearTemporaryMessages() && !isMobile()) {
            <cog-icon-button
              name="eraser"
              title="Clear all messages"
              type="button"
              (click)="onClearMessages()"
            />
          }
        </div>

        <cog-button
          class="message-form__send"
          appearance="primary"
          icon="send"
          title="Send"
          type="submit"
          [disabled]="messageForm.disabled || !messageForm.valid"
        >
          <span class="message-form__send-label">Send</span>
        </cog-button>
      </div>

      <div class="message-form__meta">
        <span class="message-form__security">
          <cog-icon name="lock" [size]="12" tone="text-subtlest" />
          <span>End-to-end encrypted · keys never leave this device</span>
        </span>

        <span class="message-form__shortcut">
          @if (isMac) {
            Cmd
          } @else {
            Ctrl
          }
          + Enter to send
        </span>
      </div>
    </form>
  `,
  styles: `
    .message-form {
      display: grid;
      gap: var(--cog-space-100);
      width: 100%;
    }

    .message-form__panel {
      display: grid;
      gap: var(--cog-space-150);
      grid-template-columns: minmax(0, 1fr) auto;
      grid-template-areas:
        'label    label'
        'textarea textarea'
        'controls send';
      align-items: end;
      border: 2px solid var(--cog-border);
      border-radius: var(--cog-radius-sm);
      background: var(--cog-surface);
      padding: var(--cog-space-150);
      transition: border-color var(--cog-dur-fast) var(--cog-ease-standard);
    }

    .message-form__panel:focus-within {
      border-color: var(--cog-brand);
    }

    .message-form__label {
      grid-area: label;
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-body-sm);
      line-height: var(--cog-lh-body-sm);
    }

    .message-form__textarea {
      grid-area: textarea;
      width: 100%;
      resize: none;
      border: 0;
      background: transparent;
      color: var(--cog-text);
      font: inherit;
      font-size: 16px;
      line-height: var(--cog-lh-body-lg);
      outline: 0;
      padding: 0;
    }

    .message-form__textarea::placeholder {
      color: var(--cog-text-subtlest);
    }

    .message-form__controls {
      grid-area: controls;
      display: flex;
      align-items: center;
      gap: var(--cog-space-100);
      flex-wrap: wrap;
    }

    .message-form__send {
      grid-area: send;
      justify-self: end;
    }

    .message-form__meta,
    .message-form__security {
      display: flex;
      align-items: center;
      gap: var(--cog-space-100);
    }

    .message-form__meta {
      justify-content: space-between;
      flex-wrap: wrap;
    }

    .message-form__powered-by,
    .message-form__meta {
      color: var(--cog-text-subtlest);
      font-size: var(--cog-fs-caption);
      line-height: var(--cog-lh-caption);
    }

    @media (max-width: 767px) {
      .message-form__panel {
        grid-template-areas:
          'label    label'
          'textarea send'
          'controls controls';
      }

      .message-form__powered-by {
        display: none;
      }

      .message-form__send-label {
        display: none;
      }

      .message-form__controls cog-button {
        min-width: 0;
      }
    }
  `,
})
export class MessageFormComponent {
  private readonly _dialog = inject(Dialog);
  private readonly _fb = inject(FormBuilder);
  private readonly _platformId = inject(PLATFORM_ID);
  private readonly _conversationService = inject(ConversationService);
  private readonly _deviceService = inject(DeviceService);

  private _previousMessage = '';

  isMac = false;
  isMobile = computed(() => this._deviceService.isMobile());

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
    this._dialog.open(AgentSelectorComponent, cognosDialogOptions);
  }

  openModelSelector() {
    this._dialog.open(ModelSelectorComponent, cognosDialogOptions);
  }

  sendMessage() {
    const content = this.messageForm.controls.content;
    const contentValue = content.value ?? '';

    if (content.invalid || this.messageForm.disabled) {
      return;
    }

    this._previousMessage = contentValue;
    const messageRequest: MessageRequest = {
      content: contentValue,
      requestId: self.crypto.randomUUID(),
    };
    this.messageService.sendMessage$.next(messageRequest);
    this.messageForm.reset();
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
