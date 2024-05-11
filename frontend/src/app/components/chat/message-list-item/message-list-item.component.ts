import { ClipboardModule } from '@angular/cdk/clipboard';
import { DatePipe } from '@angular/common';
import { Component, Input, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

import { MarkdownComponent } from 'ngx-markdown';

import { Message, isMessageFromUser } from '@app/interfaces/message';
import { AgentService } from '@app/services/agent.service';
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
  ],
  template: `
    @if (message) {
      <li class="item-grid group">
        <div
          class="flex h-12 w-12 flex-none items-center justify-center justify-self-center rounded-full bg-gray-50"
        >
          <mat-icon fontSet="bi" [fontIcon]="icon"></mat-icon>
        </div>
        <div class="item-content prose flex items-end justify-between">
          <span class="font-semibold">{{ sender }}</span>
          <span
            class="text-xs text-gray-500"
            [attr.data-timestamp]="message.createdAt.getTime()"
            >{{ message.createdAt | date: 'short' }}</span
          >
        </div>
        <article class="item-content prose prose-headings:text-xl prose-th:text-base">
          <markdown emoji>
            {{ message.decryptedData.content }}
          </markdown>
        </article>
        <div class="item-content prose flex gap-2 opacity-0 group-hover:opacity-100">
          <button
            mat-icon-button
            matTooltip="Copy to clipboard"
            aria-label="Button that copies the message to the clipboard"
            [cdkCopyToClipboard]="message.decryptedData.content"
          >
            <mat-icon fontSet="bi" fontIcon="bi-clipboard"></mat-icon>
          </button>
          <button
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
          </button>
          <button
            class="ml-auto"
            mat-icon-button
            matTooltip="Delete message"
            aria-label="Button that deletes this message"
          >
            <mat-icon fontSet="bi" fontIcon="bi-trash3"></mat-icon>
          </button>
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
export class MessageListItemComponent {
  private readonly _modelService = inject(ModelService);
  private readonly _agentService = inject(AgentService);

  @Input() message?: Message;

  get icon(): string {
    if (!this.message) {
      return 'bi-question-circle';
    }

    if (isMessageFromUser(this.message.decryptedData)) {
      return 'bi-person';
    }

    return 'bi-robot';
  }

  get sender(): string {
    if (!this.message) {
      return 'Unknown';
    }

    if (isMessageFromUser(this.message.decryptedData)) {
      return 'You';
    }

    const agent =
      this.message.decryptedData.agent_id &&
      this._agentService.getAgent(this.message.decryptedData.agent_id)();
    const model =
      this.message.decryptedData.model_id &&
      this._modelService.getModel(this.message.decryptedData.model_id)();

    let sender = 'Unknown';

    if (model) {
      sender = model.name;
    }

    if (agent) {
      sender = `${agent.name} powered by ${sender}`;
    }

    return sender;
  }
}
