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
      <li class="group flex flex-col gap-x-4 py-2 w-full">
        <div class="flex items-center gap-x-4">
          <div
            class="h-12 w-12 flex-none rounded-full bg-gray-50 flex items-center justify-center"
          >
            <mat-icon fontSet="bi" fontIcon="bi-robot"></mat-icon>
          </div>
          <span class="fw-bold">Message</span>
        </div>
        <div class="flex items-center gap-x-4">
          <div class="h-12 w-12"></div>
          <div class="flex-auto flex flex-col">
            <div class="message">
              <markdown emoji>
                {{ message.decryptedData.content }}
              </markdown>
            </div>
          </div>
        </div>
        <div class="flex opacity-0 group-hover:opacity-100">
          <button
            mat-icon-button
            matTooltip="Copy to clipboard"
            aria-label="Button that copies the message to the clipboard"
            [cdkCopyToClipboard]="message.decryptedData.content"
          >
            <mat-icon fontSet="bi" fontIcon="bi-clipboard"></mat-icon>
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
