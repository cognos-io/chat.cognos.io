import { ClipboardModule } from '@angular/cdk/clipboard';
import { DatePipe } from '@angular/common';
import { Component, Input, OnDestroy, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

import { Subject, takeUntil } from 'rxjs';

import { MarkdownComponent } from 'ngx-markdown';

import { ConfirmationDialogComponent } from '@app/components/confirmation-dialog/confirmation-dialog.component';
import { Agent } from '@app/interfaces/agent';
import { Message, isMessageFromUser } from '@app/interfaces/message';
import { Model } from '@app/interfaces/model';
import { AgentService } from '@app/services/agent.service';
import { MessageService } from '@app/services/message.service';
import { ModelService } from '@app/services/model.service';

@Component({
  selector: 'app-message-list-item',
  standalone: true,
  imports: [
    MarkdownComponent,
    MatIconModule,
    MatButtonModule,
    MatTooltipModule,
    ClipboardModule,
    DatePipe,
    MatDialogModule,
  ],
  template: `
    @if (message) {
      <li
        class="item-grid group"
        [id]="message.record_id"
        [attr.data-agent-id]="message.decryptedData.agent_id"
        [attr.data-model-id]="message.decryptedData.model_id"
        [attr.data-owner-id]="message.decryptedData.owner_id"
        [attr.data-parent-id]="message.parentMessageId"
      >
        <div
          class="flex h-12 w-12 flex-none items-center justify-center justify-self-center rounded-full bg-gray-50"
        >
          <mat-icon fontSet="bi" [fontIcon]="icon"></mat-icon>
        </div>
        <div class="item-content prose flex items-end justify-between">
          <div>
            @if (isMessageFromUser(message.decryptedData)) {
              <span class="font-semibold">You</span>
            } @else {
              @if (agent) {
                <span class="font-semibold">{{ agent.name }}</span>
                @if (model) {
                  <span class="italic text-gray-500"> powered by </span>
                }
              }
              @if (model) {
                <span class="font-semibold">{{ model.name }}</span>
              }
            }
          </div>
          <span
            class="text-xs text-gray-500"
            [attr.data-timestamp]="message.createdAt.getTime()"
            >{{ message.createdAt | date: 'short' }}</span
          >
        </div>
        <article class="item-content prose prose-headings:text-xl prose-th:text-base">
          @if (message.decryptedData.content) {
            <markdown emoji>
              {{ message.decryptedData.content }}
            </markdown>
          } @else {
            <p i18n class="italic text-gray-500">
              This message is empty or the AI did not generate a response, please try
              again.
            </p>
          }
        </article>
        <div class="item-content prose flex gap-2 opacity-0 group-hover:opacity-100">
          @if (message.decryptedData.content) {
            <button
              mat-icon-button
              matTooltip="Copy to clipboard"
              aria-label="Button that copies the message to the clipboard"
              [cdkCopyToClipboard]="message.decryptedData.content"
            >
              <mat-icon fontSet="bi" fontIcon="bi-clipboard"></mat-icon>
            </button>
          }
          @if (message.record_id) {
            <div class="ml-auto flex gap-2">
              @if (message.expires) {
                <button
                  mat-icon-button
                  matTooltip="Keep this temporary message. It will not be automatically deleted any more."
                  aria-label="Button that keeps this temporary message"
                  (click)="onKeepMessage(message)"
                >
                  <mat-icon fontSet="bi" fontIcon="bi-life-preserver"></mat-icon>
                </button>
              }
              <!-- <button
                  mat-icon-button
                  matTooltip="Flag or report message"
                  aria-label="Button that enables flagging and reporting of messages"
                >
                  <mat-icon fontSet="bi" fontIcon="bi-flag"></mat-icon>
                </button>
                <button
                  mat-icon-button
                  matTooltip="Reply to this message"
                  aria-label="Button that enables replying to this message specifically"
                >
                  <mat-icon fontSet="bi" fontIcon="bi-reply"></mat-icon>
                </button> -->
              <button
                mat-icon-button
                matTooltip="Delete message"
                aria-label="Button that deletes this message"
                (click)="onDeleteMessage(message)"
              >
                <mat-icon fontSet="bi" fontIcon="bi-trash3"></mat-icon>
              </button>
            </div>
          }
        </div>
      </li>
    }
  `,
  styles: `
    .item-grid {
      @apply grid w-full auto-rows-max grid-cols-6 items-center gap-y-2 py-2 lg:grid-cols-8;
    }

    .item-content {
      @apply col-span-5 col-end-7 lg:col-span-7 lg:col-end-9;
    }
  `,
})
export class MessageListItemComponent implements OnDestroy {
  private readonly _modelService = inject(ModelService);
  private readonly _agentService = inject(AgentService);
  private readonly _messageService = inject(MessageService);
  private readonly _dialogService = inject(MatDialog);
  private readonly _destroyed$ = new Subject<void>();

  @Input() message?: Message;

  // exported for use in template
  isMessageFromUser = isMessageFromUser;

  get icon(): string {
    if (!this.message) {
      return 'bi-question-circle';
    }

    if (isMessageFromUser(this.message.decryptedData)) {
      return 'bi-person';
    }

    return 'bi-robot';
  }

  get agent(): Agent | undefined {
    const agent_id = this.message?.decryptedData.agent_id;
    if (!this.message || !agent_id) {
      return undefined;
    }

    return this._agentService.getAgent(agent_id)();
  }

  get model(): Model | undefined {
    const model_id = this.message?.decryptedData.model_id;
    if (!this.message || !model_id) {
      return undefined;
    }

    return this._modelService.getModel(model_id)();
  }

  ngOnDestroy(): void {
    this._destroyed$.next();
    this._destroyed$.complete();
  }

  onDeleteMessage(message: Message) {
    this._dialogService
      .open(ConfirmationDialogComponent, {
        data: {
          message: 'Are you sure you want to delete this message?',
        },
      })
      .afterClosed()
      .pipe(takeUntil(this._destroyed$))
      .subscribe((confirmed) => {
        if (confirmed) {
          this._messageService.deleteMessage(message);
        }
      });
  }

  onKeepMessage(message: Message) {
    // this._messageService.keepMessage(message);
  }
}
