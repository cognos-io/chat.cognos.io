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
  untracked,
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
  CognosLozengeComponent,
} from '@cognos/ui-angular';

import { AgentService } from '@app/services/agent.service';
import { BillingService } from '@app/services/billing.service';
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
    CognosLozengeComponent,
    ModelSelectorComponent,
  ],
  template: `
    <form class="message-form" [formGroup]="messageForm" (submit)="sendMessage()">
      @if (billing.isReadOnly()) {
        <div class="message-form__locked" role="status">
          <span class="message-form__locked-text">
            Choose a plan to keep chatting. You can still read your chats.
          </span>
          <cog-button appearance="primary" type="button" (click)="openPlanGate()">
            View plans
          </cog-button>
        </div>
      }

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
          @if (billing.isTrial()) {
            <cog-lozenge tone="blue" class="message-form__trial">
              Trial · CHF {{ billing.balanceChf().toFixed(2) }} left
            </cog-lozenge>
          }

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
            [disabled]="messageForm.disabled || !messageForm.valid || !canSendMessage()"
          >
            <span class="message-form__send-label">Send</span>
          </cog-button>
        </div>
      </div>

      <div class="message-form__meta">
        <span class="message-form__security">
          <cog-icon name="lock" [size]="12" tone="text-subtlest" />
          <span>End-to-end encrypted · keys are encrypted before backup</span>
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

    .message-form__trial {
      margin-right: var(--cog-space-050);
    }

    .message-form__locked {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--cog-space-150);
      flex-wrap: wrap;
      border: 1px solid var(--cog-border);
      border-radius: var(--cog-radius-sm);
      background: var(--cog-surface-sunken, var(--cog-surface));
      padding: var(--cog-space-150);
    }

    .message-form__locked-text {
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-body-sm);
      line-height: var(--cog-lh-body-sm);
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
  public readonly billing = inject(BillingService);

  readonly canSendMessage = computed(
    () => this.modelService.selectedModel().isEligible && !this.billing.isReadOnly(),
  );

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

    // Status-driven enable/disable + content restore. This must react only to
    // send status — the read-only check is read untracked so a billing refresh
    // can't re-fire this effect and clobber the composer's in-progress text via
    // the None branch.
    effect(() => {
      const status = this.messageService.status();

      if (untracked(() => this.billing.isReadOnly())) {
        this.disableForm();
        return;
      }

      switch (status) {
        case MessageStatus.Sending:
          this.disableForm();
          break;
        case MessageStatus.Success:
          this._previousMessage = '';
          this.enableForm();
          // Reconcile the trial pill with the balance the completion just spent.
          this.billing.refresh();
          break;
        case MessageStatus.None:
        case MessageStatus.ErrorSending:
          // Only restore a prior draft (e.g. after a failed send). Never patch
          // an empty string over the composer — status settles to None during
          // conversation load and that would wipe text the user is typing.
          if (this._previousMessage) {
            this.messageForm.patchValue({ content: this._previousMessage });
          }
          this.enableForm();
          break;
      }
    });

    // An inactive plan is read-only: lock the composer whenever the plan flips
    // to inactive, and restore it (unless mid-send) if the plan becomes active
    // again. Kept separate so it never touches the composer's content.
    effect(() => {
      if (this.billing.isReadOnly()) {
        this.disableForm();
      } else if (this.messageService.status() !== MessageStatus.Sending) {
        this.enableForm();
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

  openPlanGate() {
    this.billing.openPlanGate('inactive');
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

    if (content.invalid || this.messageForm.disabled || !this.canSendMessage()) {
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
