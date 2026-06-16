import { ClipboardModule } from '@angular/cdk/clipboard';
import { Dialog } from '@angular/cdk/dialog';
import { DatePipe, NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  Input,
  inject,
  signal,
} from '@angular/core';

import { MarkdownComponent } from 'ngx-markdown';

import {
  CognosAssistantMessageComponent,
  CognosBranchSwitcherComponent,
  CognosButtonComponent,
  CognosIconButtonComponent,
  CognosUserMessageComponent,
  MessageBranchInfo,
} from '@cognos/ui-angular';

import { ConfirmationDialogComponent } from '@app/components/confirmation-dialog/confirmation-dialog.component';
import { Message, isMessageFromUser } from '@app/interfaces/message';
import { Model } from '@app/interfaces/model';
import { Persona } from '@app/interfaces/persona';
import { MessageService } from '@app/services/message.service';
import { ModelService } from '@app/services/model.service';
import { PersonaService } from '@app/services/persona.service';
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
    CognosBranchSwitcherComponent,
    CognosButtonComponent,
  ],
  template: `
    @if (message) {
      <li
        class="message-list-item"
        [id]="message.record_id"
        [attr.data-persona-id]="message.decryptedData.persona_id"
        [attr.data-model-id]="message.decryptedData.model_id"
        [attr.data-owner-id]="message.decryptedData.owner_id"
        [attr.data-parent-id]="message.parentMessageId"
      >
        <ng-template #messageActions>
          @if (branchInfo(); as info) {
            <cog-branch-switcher
              [index]="info.index"
              [count]="info.count"
              (previous)="onPreviousBranch()"
              (next)="onNextBranch()"
            />
          }

          @if (message.decryptedData.content) {
            <cog-icon-button
              name="copy"
              title="Copy to clipboard"
              [cdkCopyToClipboard]="message.decryptedData.content"
            />
          }

          @if (canEdit()) {
            <cog-icon-button name="pencil" title="Edit message" (click)="startEdit()" />
          }

          @if (canRegenerate()) {
            <cog-icon-button
              name="rotate-cw"
              title="Regenerate response"
              (click)="onRegenerate()"
            />
          }

          @if (message.expires) {
            <cog-icon-button
              name="pin"
              title="Keep this temporary message"
              (click)="onKeepMessage(message)"
            />
          }

          @if (message.record_id && !message.decryptedData.deleted) {
            <cog-icon-button
              name="x"
              title="Delete message"
              (click)="onDeleteMessage(message)"
            />
          }
        </ng-template>

        @if (isMessageFromUser(message.decryptedData)) {
          <div class="message-list-item__user">
            <cog-user-message [meta]="userMeta()" [branchCount]="branchPointCount()">
              @if (isEditing()) {
                <div class="message-list-item__edit">
                  <textarea
                    class="message-list-item__edit-input"
                    [value]="editDraft()"
                    (input)="editDraft.set($any($event.target).value)"
                    (keydown.escape)="cancelEdit()"
                    rows="3"
                    aria-label="Edit message"
                    i18n-aria-label="@@message.edit.input"
                  ></textarea>
                  <div class="message-list-item__edit-actions">
                    <cog-button appearance="subtle" (click)="cancelEdit()">
                      <ng-container i18n="@@message.edit.cancel">Cancel</ng-container>
                    </cog-button>
                    <cog-button
                      appearance="primary"
                      [disabled]="!editDraft().trim()"
                      (click)="saveEdit()"
                    >
                      <ng-container i18n="@@message.edit.save">Save</ng-container>
                    </cog-button>
                  </div>
                </div>
              } @else if (message.decryptedData.deleted) {
                <p class="message-list-item__deleted" i18n="@@message.deleted">
                  Deleted message
                </p>
              } @else if (message.decryptedData.content) {
                <markdown emoji katex>
                  {{ message.decryptedData.content }}
                </markdown>
              } @else {
                <p class="message-list-item__empty">This message is empty.</p>
              }

              <!--
                The actions div must stay a near-top-level child of
                cog-user-message so it projects into the hover-only actions slot
                outside the bubble. Nesting it deeper (e.g. inside the edit
                @else above) breaks [cogMessageActions] projection and the
                buttons fall back into the bubble body, always visible.
              -->
              @if (
                !isEditing() && (message.decryptedData.content || message.record_id)
              ) {
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
              [branchCount]="branchPointCount()"
            >
              @if (message.decryptedData.deleted) {
                <p class="message-list-item__deleted" i18n="@@message.deleted">
                  Deleted message
                </p>
              } @else if (message.decryptedData.content) {
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
      width: 100%;
      max-width: var(--chat-container-width);
      margin-inline: auto;
      padding-inline: var(--cog-space-200);
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

    .message-list-item__empty,
    .message-list-item__deleted {
      margin: 0;
      color: var(--cog-text-subtlest);
      font-style: italic;
    }

    .message-list-item__streaming {
      margin: 0;
      white-space: pre-wrap;
    }

    .message-list-item__edit {
      display: grid;
      gap: var(--cog-space-100);
      min-width: min(70vw, 480px);
    }

    .message-list-item__edit-input {
      width: 100%;
      box-sizing: border-box;
      min-height: 64px;
      resize: vertical;
      border: 1px solid var(--cog-border);
      border-radius: var(--cog-radius-xs);
      background: var(--cog-input-bg);
      padding: var(--cog-space-100);
      color: var(--cog-text);
      font: inherit;
      font-size: var(--cog-fs-body-lg);
      line-height: var(--cog-lh-body-lg);
    }

    .message-list-item__edit-input:focus-visible {
      border-color: var(--cog-brand);
      background: var(--cog-input-bg-focus);
      outline: 2px solid var(--cog-brand);
      outline-offset: 1px;
    }

    .message-list-item__edit-actions {
      display: flex;
      justify-content: flex-end;
      gap: var(--cog-space-075);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MessageListItemComponent {
  private readonly _modelService = inject(ModelService);
  private readonly _personaService = inject(PersonaService);
  private readonly _messageService = inject(MessageService);
  private readonly _dialog = inject(Dialog);

  @Input() message?: Message;

  isMessageFromUser = isMessageFromUser;

  // Navigation metadata when this message is one of several sibling branches.
  branchInfo(): MessageBranchInfo | undefined {
    return this.message ? this._messageService.branchInfo(this.message) : undefined;
  }

  // Number of direct replies/versions when this message is a branch point — the
  // `⑂ N` tick on the parent.
  branchPointCount(): number {
    return (this.message && this._messageService.branchPointCount(this.message)) || 0;
  }

  // A persisted assistant message that replied to a parent can be regenerated
  // into a new sibling branch.
  canRegenerate(): boolean {
    const message = this.message;
    return (
      !!message &&
      !!message.record_id &&
      !message.isStreaming &&
      !message.decryptedData.deleted &&
      !isMessageFromUser(message.decryptedData) &&
      !!message.parentMessageId
    );
  }

  onRegenerate(): void {
    if (this.message) {
      this._messageService.regenerate(this.message);
    }
  }

  // Inline-edit state for a user message. Editing forks the conversation: the
  // amended text is sent as a new sibling branch (see MessageService.editMessage).
  protected readonly isEditing = signal(false);
  protected readonly editDraft = signal('');

  // A persisted, non-streaming user message with content can be edited into a
  // new branch. Assistant messages use regenerate instead.
  canEdit(): boolean {
    const message = this.message;
    return (
      !!message &&
      !!message.record_id &&
      !message.isStreaming &&
      !message.decryptedData.deleted &&
      isMessageFromUser(message.decryptedData) &&
      !!message.decryptedData.content
    );
  }

  startEdit(): void {
    if (!this.message) {
      return;
    }
    this.editDraft.set(this.message.decryptedData.content ?? '');
    this.isEditing.set(true);
  }

  cancelEdit(): void {
    this.isEditing.set(false);
    this.editDraft.set('');
  }

  saveEdit(): void {
    const message = this.message;
    const content = this.editDraft().trim();
    if (!message || !content) {
      return;
    }
    this._messageService.editMessage(message, content);
    this.isEditing.set(false);
    this.editDraft.set('');
  }

  onPreviousBranch(): void {
    if (this.message) {
      this._messageService.previousBranch(this.message);
    }
  }

  onNextBranch(): void {
    if (this.message) {
      this._messageService.nextBranch(this.message);
    }
  }

  get persona(): Persona | undefined {
    const personaId = this.message?.decryptedData.persona_id;
    if (!this.message || !personaId) {
      return undefined;
    }

    return this._personaService.getPersona(personaId)();
  }

  get model(): Model | undefined {
    const modelId = this.message?.decryptedData.model_id;
    if (!this.message || !modelId) {
      return undefined;
    }

    return this._modelService.getModel(modelId);
  }

  assistantLabel() {
    if (this.persona && this.model) {
      return `${this.persona.name} · ${this.model.name}`;
    }

    return this.persona?.name ?? this.model?.name ?? 'Cognos';
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
