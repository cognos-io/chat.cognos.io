import { Dialog } from '@angular/cdk/dialog';
import { OverlayModule } from '@angular/cdk/overlay';
import { CdkTextareaAutosize } from '@angular/cdk/text-field';
import { isPlatformBrowser } from '@angular/common';
import {
  Component,
  PLATFORM_ID,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
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
    OverlayModule,
    CognosButtonComponent,
    CognosIconButtonComponent,
    CognosIconComponent,
    ModelSelectorComponent,
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
          placeholder="Message with Cognos"
          (keydown.control.enter)="isMac ? undefined : sendMessage()"
          (keydown.meta.enter)="isMac ? sendMessage() : undefined"
        ></textarea>

        <div class="message-form__controls">
          <cog-button
            #modelTrigger="cdkOverlayOrigin"
            cdkOverlayOrigin
            appearance="default"
            iconAfter="chevron-down"
            type="button"
            (click)="toggleModelSelector()"
          >
            {{ modelService.selectedModel().name }}
          </cog-button>

          <ng-template
            cdkConnectedOverlay
            [cdkConnectedOverlayOrigin]="modelTrigger"
            [cdkConnectedOverlayOpen]="modelSelectorOpen()"
            [cdkConnectedOverlayHasBackdrop]="true"
            cdkConnectedOverlayBackdropClass="cdk-overlay-transparent-backdrop"
            [cdkConnectedOverlayPositions]="modelSelectorPositions"
            (backdropClick)="closeModelSelector()"
            (detach)="closeModelSelector()"
            (overlayKeydown)="onOverlayKeydown($event)"
          >
            <app-model-selector
              (modelSelected)="closeModelSelector()"
            ></app-model-selector>
          </ng-template>

          <cog-icon-button
            name="sparkles"
            title="Choose assistant — {{ agentService.selectedAgent().name }}"
            type="button"
            (click)="openAgentSelector()"
          />

          @if (canClearTemporaryMessages() && !isMobile()) {
            <cog-icon-button
              name="eraser"
              title="Clear all messages"
              type="button"
              (click)="onClearMessages()"
            />
          }

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
      position: relative;
      display: grid;
      gap: var(--cog-space-150);
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
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }

    .message-form__textarea {
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
      display: flex;
      align-items: center;
      gap: var(--cog-space-100);
      flex-wrap: wrap;
    }

    .message-form__send {
      margin-left: auto;
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

    .message-form__meta {
      color: var(--cog-text-subtlest);
      font-size: var(--cog-fs-caption);
      line-height: var(--cog-lh-caption);
    }

    .message-form__send-label {
      display: none;
    }

    @media (max-width: 767px) {
      .message-form__controls cog-button {
        min-width: 0;
      }

      .message-form__meta {
        display: none;
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

  readonly modelSelectorOpen = signal(false);

  readonly modelSelectorPositions = [
    {
      originX: 'start' as const,
      originY: 'top' as const,
      overlayX: 'start' as const,
      overlayY: 'bottom' as const,
      offsetY: -8,
    },
    {
      originX: 'start' as const,
      originY: 'bottom' as const,
      overlayX: 'start' as const,
      overlayY: 'top' as const,
      offsetY: 8,
    },
  ];

  openAgentSelector() {
    this._dialog.open(AgentSelectorComponent, cognosDialogOptions);
  }

  toggleModelSelector() {
    this.modelSelectorOpen.update((open) => !open);
  }

  closeModelSelector() {
    this.modelSelectorOpen.set(false);
  }

  onOverlayKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      this.closeModelSelector();
    }
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
