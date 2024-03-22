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
      <li class="group flex gap-x-4 py-5 w-full">
        <div
          class="h-12 w-12 flex-none rounded-full bg-gray-50 flex items-center justify-center"
        >
          <mat-icon fontSet="bi" fontIcon="bi-robot"></mat-icon>
        </div>
        <div class="flex-auto flex flex-col">
          <span class="fw-bold mb-2">Message</span>
          <div class="message">
            <markdown emoji>
              {{ message.decryptedData.content }}
            </markdown>
          </div>
          <div class="flex justify-end opacity-0 group-hover:opacity-100">
            <button
              mat-icon-button
              matTooltip="Copy to clipboard"
              aria-label="Button that copies the message to the clipboard"
              [cdkCopyToClipboard]="message.decryptedData.content"
            >
              <mat-icon fontSet="bi" fontIcon="bi-clipboard"></mat-icon>
            </button>
          </div>
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
