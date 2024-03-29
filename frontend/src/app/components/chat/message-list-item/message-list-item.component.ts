import { ClipboardModule } from '@angular/cdk/clipboard';
import { Component, Input } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';

import { MarkdownComponent } from 'ngx-markdown';

import { Message } from '@app/interfaces/message';

@Component({
  selector: 'app-message-list-item',
  standalone: true,
  imports: [
    MarkdownComponent,
    MatIconModule,
    MatButtonModule,
    MatTooltipModule,
    ClipboardModule,
  ],
  template: `
    @if (message) {
      <li
        class="group grid w-full auto-rows-max grid-cols-6 items-center gap-y-2 py-2 lg:grid-cols-8"
      >
        <div
          class="flex h-12 w-12 flex-none items-center justify-center justify-self-center rounded-full bg-gray-50"
        >
          <mat-icon fontSet="bi" fontIcon="bi-robot"></mat-icon>
        </div>
        <span class="fw-bold col-span-5">Message</span>
        <article
          class="prose col-span-5 col-end-7 prose-headings:text-xl prose-th:text-base lg:col-span-7 lg:col-end-9"
        >
          <markdown emoji>
            {{ message.decryptedData.content }}
          </markdown>
        </article>
        <div
          class="col-span-5 col-end-7 flex gap-2 px-2 opacity-0 group-hover:opacity-100 lg:col-span-7 lg:col-end-9 lg:px-4"
        >
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
    .message-wrapper {
    }
  `,
})
export class MessageListItemComponent {
  @Input() message?: Message;
}
