import { ClipboardModule } from '@angular/cdk/clipboard';
import { Dialog } from '@angular/cdk/dialog';
import { DatePipe, NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, Input, inject } from '@angular/core';

import { MarkdownComponent } from 'ngx-markdown';

import {
  CognosAssistantMessageComponent,
  CognosIconButtonComponent,
  CognosUserMessageComponent,
} from '@cognos/ui-angular';

import { ConfirmationDialogComponent } from '@app/components/confirmation-dialog/confirmation-dialog.component';
import { Agent } from '@app/interfaces/agent';
import { Message, isMessageFromUser } from '@app/interfaces/message';
import { Model } from '@app/interfaces/model';
import { AgentService } from '@app/services/agent.service';
import { MessageService } from '@app/services/message.service';
import { ModelService } from '@app/services/model.service';
import { cognosDialogOptions } from '@app/utils/dialog-options';

@Component({
  selector: 'app-message-list-item',
  standalone: true,
  imports: [
    MarkdownComponent,
    ClipboardModule,
    NgTemplateOutlet,
    CognosAssistantMessageComponent,
    CognosUserMessageComponent,
    CognosIconButtonComponent,
  ],
  template: `
    @if (message) {
      <li
        class="message-list-item"
        [id]="message.record_id"
        [attr.data-agent-id]="message.decryptedData.agent_id"
        [attr.data-model-id]="message.decryptedData.model_id"
        [attr.data-owner-id]="message.decryptedData.owner_id"
        [attr.data-parent-id]="message.parentMessageId"
      >
        <ng-template #messageActions>
          @if (message.decryptedData.content) {
            <cog-icon-button
              name="copy"
              title="Copy to clipboard"
              [cdkCopyToClipboard]="message.decryptedData.content"
            />
          }

          @if (message.expires) {
            <cog-icon-button
              name="pin"
              title="Keep this temporary message"
              (click)="onKeepMessage(message)"
            />
          }

          @if (message.record_id) {
            <cog-icon-button
              name="x"
              title="Delete message"
              (click)="onDeleteMessage(message)"
            />
          }
        </ng-template>

        @if (isMessageFromUser(message.decryptedData)) {
          <div class="message-list-item__user">
            <cog-user-message [meta]="userMeta()">
              @if (message.decryptedData.content) {
                <markdown emoji katex>
                  {{ message.decryptedData.content }}
                </markdown>
              } @else {
                <p class="message-list-item__empty">This message is empty.</p>
              }

              @if (message.decryptedData.content || message.record_id) {
                <div cogMessageActions class="message-list-item__actions">
                  <ng-container *ngTemplateOutlet="messageActions"></ng-container>
                </div>
              }
            </cog-user-message>
          </div>
        } @else {
          <div class="message-list-item__assistant">
            <cog-assistant-message
              [model]="assistantLabel()"
              [showActions]="false"
              [time]="messageTime()"
            >
              @if (message.decryptedData.content) {
                @if (message.isStreaming) {
                  <p class="message-list-item__streaming">
                    {{ message.decryptedData.content }}
                  </p>
                } @else {
                  <markdown emoji katex>
                    {{ message.decryptedData.content }}
                  </markdown>
                }
              } @else {
                <p class="message-list-item__empty">
                  This message is empty or the AI did not generate a response, please
                  try again.
                </p>
              }

              @if (message.decryptedData.content || message.record_id) {
                <div cogMessageActions class="message-list-item__actions">
                  <ng-container *ngTemplateOutlet="messageActions"></ng-container>
                </div>
              }
            </cog-assistant-message>
          </div>
        }
      </li>
    }
  `,
  styles: `
    :host {
      display: block;
    }

    .message-list-item {
      display: grid;
      gap: var(--cog-space-100);
      padding-block: var(--cog-space-100);
    }

    .message-list-item__assistant,
    .message-list-item__user {
      min-width: 0;
    }

    .message-list-item__actions {
      display: flex;
      gap: var(--cog-space-050);
    }

    .message-list-item__empty {
      margin: 0;
      color: var(--cog-text-subtlest);
      font-style: italic;
    }

    .message-list-item__streaming {
      margin: 0;
      white-space: pre-wrap;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MessageListItemComponent {
  private readonly _modelService = inject(ModelService);
  private readonly _agentService = inject(AgentService);
  private readonly _messageService = inject(MessageService);
  private readonly _dialog = inject(Dialog);

  @Input() message?: Message;

  isMessageFromUser = isMessageFromUser;

  get agent(): Agent | undefined {
    const agentId = this.message?.decryptedData.agent_id;
    if (!this.message || !agentId) {
      return undefined;
    }

    return this._agentService.getAgent(agentId)();
  }

  get model(): Model | undefined {
    const modelId = this.message?.decryptedData.model_id;
    if (!this.message || !modelId) {
      return undefined;
    }

    return this._modelService.getModel(modelId);
  }

  assistantLabel() {
    if (this.agent && this.model) {
      return `${this.agent.name} · ${this.model.name}`;
    }

    return this.agent?.name ?? this.model?.name ?? 'Cognos';
  }

  userMeta() {
    const time = this.formatTimestamp(this.message?.createdAt);

    return time ? `Encrypted · ${time}` : 'Encrypted';
  }

  messageTime() {
    return this.formatTimestamp(this.message?.createdAt);
  }

  // formatTimestamp guards against invalid dates: DatePipe.transform throws on
  // an Invalid Date, and an uncaught throw here aborts the whole change
  // detection pass — blanking sibling components such as the message composer.
  private formatTimestamp(date?: Date): string {
    if (!date || Number.isNaN(date.getTime())) {
      return '';
    }

    return new DatePipe('en-GB').transform(date, 'short') ?? '';
  }

  onDeleteMessage(message: Message) {
    this._dialog
      .open(ConfirmationDialogComponent, {
        ...cognosDialogOptions,
        data: {
          message: 'Are you sure you want to delete this message?',
        },
      })
      .closed.subscribe((confirmed) => {
        if (confirmed) {
          this._messageService.deleteMessage(message);
        }
      });
  }

  onKeepMessage(message: Message) {
    this._messageService.keepExpiringMessage(message);
  }
}
