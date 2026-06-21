import { ClipboardModule } from '@angular/cdk/clipboard';
import { Dialog } from '@angular/cdk/dialog';
import { DatePipe, NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  ChangeDetectorRef,
  Component,
  DestroyRef,
  ElementRef,
  HostListener,
  Input,
  effect,
  inject,
  signal,
} from '@angular/core';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';

import {
  CognosAssistantMessageComponent,
  CognosBranchSwitcherComponent,
  CognosButtonComponent,
  CognosIconButtonComponent,
  CognosMenuComponent,
  type CognosMenuItem,
  CognosUserMessageComponent,
  MessageBranchInfo,
} from '@cognos/ui-angular';

import { RedactedMarkdownComponent } from '@app/components/chat/redacted-markdown/redacted-markdown.component';
import { ConfirmationDialogComponent } from '@app/components/confirmation-dialog/confirmation-dialog.component';
import { Message, isMessageFromUser } from '@app/interfaces/message';
import { Model } from '@app/interfaces/model';
import { Persona } from '@app/interfaces/persona';
import { containsRedactionToken } from '@app/redaction';
import { ConversationService } from '@app/services/conversation.service';
import { MessageService } from '@app/services/message.service';
import { ModelService } from '@app/services/model.service';
import { PersonaService } from '@app/services/persona.service';
import { RedactionService } from '@app/services/redaction.service';
import { cognosDialogOptions } from '@app/utils/dialog-options';

@Component({
  selector: 'app-message-list-item',
  standalone: true,
  imports: [
    RedactedMarkdownComponent,
    ClipboardModule,
    NgTemplateOutlet,
    CognosAssistantMessageComponent,
    CognosUserMessageComponent,
    CognosIconButtonComponent,
    CognosBranchSwitcherComponent,
    CognosButtonComponent,
    CognosMenuComponent,
    TranslocoModule,
  ],
  template: `
    @if (message) {
      <li
        *transloco="let t"
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
            @if (containsRedaction(message.decryptedData.content)) {
              <!-- Redacted content: let the reader choose what lands on the
                   clipboard — the real values or the placeholder version. -->
              <span class="message-list-item__copy-wrap">
                <cog-icon-button
                  [name]="copied() ? 'check' : 'copy'"
                  [tone]="copied() ? 'success' : undefined"
                  [title]="copied() ? t('chat.message.copied') : t('chat.message.copy')"
                  [selected]="copyMenuOpen()"
                  (click)="toggleCopyMenu($event)"
                />
                @if (copyMenuOpen()) {
                  <div class="message-list-item__copy-menu">
                    <cog-menu
                      [items]="copyMenuItems()"
                      (itemSelect)="onCopySelect($event)"
                    />
                  </div>
                }
              </span>
            } @else {
              <cog-icon-button
                [name]="copied() ? 'check' : 'copy'"
                [tone]="copied() ? 'success' : undefined"
                [title]="copied() ? t('chat.message.copied') : t('chat.message.copy')"
                [cdkCopyToClipboard]="hydrated(message.decryptedData.content)"
                (cdkCopyToClipboardCopied)="onCopied()"
              />
            }
          }

          @if (canEdit()) {
            <cog-icon-button
              name="pencil"
              [title]="t('chat.message.edit')"
              (click)="startEdit()"
            />
          }

          @if (canRegenerate()) {
            <cog-icon-button
              name="rotate-cw"
              [title]="t('chat.message.regenerate')"
              (click)="onRegenerate()"
            />
          }

          @if (message.expires) {
            <cog-icon-button
              name="pin"
              [title]="t('chat.message.keep')"
              (click)="onKeepMessage(message)"
            />
          }

          @if (message.record_id && !message.decryptedData.deleted) {
            <cog-icon-button
              name="x"
              [title]="t('chat.message.delete')"
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
                    [attr.aria-label]="t('chat.message.editInputAria')"
                  ></textarea>
                  <div class="message-list-item__edit-actions">
                    <cog-button appearance="subtle" (click)="cancelEdit()">
                      {{ t('chat.message.editCancel') }}
                    </cog-button>
                    <cog-button
                      appearance="primary"
                      [disabled]="!editDraft().trim()"
                      (click)="saveEdit()"
                    >
                      {{ t('chat.message.editSave') }}
                    </cog-button>
                  </div>
                </div>
              } @else if (message.decryptedData.deleted) {
                <p class="message-list-item__deleted">
                  {{ t('chat.message.deleted') }}
                </p>
              } @else if (message.decryptedData.content) {
                <app-redacted-markdown [content]="message.decryptedData.content" />
              } @else {
                <p class="message-list-item__empty">
                  {{ t('chat.message.empty') }}
                </p>
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
                <p class="message-list-item__deleted">
                  {{ t('chat.message.deleted') }}
                </p>
              } @else if (message.decryptedData.content) {
                @if (message.isStreaming) {
                  <p class="message-list-item__streaming">
                    {{ hydrated(message.decryptedData.content) }}
                  </p>
                } @else {
                  <app-redacted-markdown [content]="message.decryptedData.content" />
                }
              } @else {
                <p class="message-list-item__empty">
                  {{ t('chat.message.emptyAssistant') }}
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

    .message-list-item__copy-wrap {
      position: relative;
      display: inline-flex;
    }

    .message-list-item__copy-menu {
      position: absolute;
      top: calc(100% + var(--cog-space-050));
      left: 0;
      z-index: 10;
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
  private readonly _conversationService = inject(ConversationService);
  private readonly _redactionService = inject(RedactionService);
  private readonly _cdr = inject(ChangeDetectorRef);
  private readonly _dialog = inject(Dialog);
  private readonly _transloco = inject(TranslocoService);
  private readonly _elementRef = inject<ElementRef<HTMLElement>>(ElementRef);

  // Copy-options menu (only offered for messages containing redactions).
  readonly copyMenuOpen = signal(false);

  // Transient "copied" state: the copy icon becomes a green tick for a moment
  // after a successful copy, then reverts.
  readonly copied = signal(false);
  private _copiedTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this._copiedTimer));
  }

  onCopied(): void {
    this.copied.set(true);
    clearTimeout(this._copiedTimer);
    this._copiedTimer = setTimeout(() => {
      this.copied.set(false);
      this._cdr.markForCheck();
    }, 2000);
  }

  // Redaction mappings load asynchronously after the view renders; when they
  // arrive (revision bumps), re-run change detection so placeholders hydrate.
  private readonly _hydrationEffect = effect(() => {
    this._redactionService.revision();
    this._cdr.markForCheck();
  });

  @Input() message?: Message;

  isMessageFromUser = isMessageFromUser;

  // hydrated swaps placeholder tokens back to their originals for display only.
  // Stored content stays redacted; unknown tokens render as-is.
  hydrated(content?: string | null): string {
    if (!content) {
      return '';
    }
    return this._redactionService.hydrate(
      this._conversationService.conversation()?.record.id,
      content,
    );
  }

  // True when the stored content carries redaction placeholders, so copying
  // offers a choice between the real values and the placeholder version.
  containsRedaction(content?: string | null): boolean {
    return !!content && containsRedactionToken(content);
  }

  copyMenuItems(): CognosMenuItem[] {
    return [
      { title: this._transloco.translate('chat.message.copyWithValues'), icon: 'copy' },
      {
        title: this._transloco.translate('chat.message.copyRedacted'),
        icon: 'shield-check',
      },
    ];
  }

  toggleCopyMenu(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.copyMenuOpen.update((open) => !open);
  }

  onCopySelect(index: number): void {
    const content = this.message?.decryptedData.content ?? '';
    const text = index === 0 ? this.hydrated(content) : this.redactedCopy(content);
    void globalThis.navigator?.clipboard?.writeText(text);
    this.onCopied();
    this.copyMenuOpen.set(false);
  }

  // Close the copy menu when clicking anywhere outside this message item.
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (!this.copyMenuOpen()) {
      return;
    }
    const target = event.target;
    if (target instanceof Node && !this._elementRef.nativeElement.contains(target)) {
      this.copyMenuOpen.set(false);
    }
  }

  // The placeholder version of the content: each token becomes a neutral
  // "[redacted]" marker, safe to paste/share without exposing originals.
  private redactedCopy(content: string): string {
    const marker = this._transloco.translate('chat.message.redactedMarker');
    return content.replace(/\[\[PII_[A-Z]+_[A-Z0-9]+\]\]/g, marker);
  }

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
    // Edit the original value, not the placeholder; re-redaction happens on save.
    this.editDraft.set(this.hydrated(this.message.decryptedData.content));
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

    return time
      ? this._transloco.translate('chat.message.encryptedWithTime', { time })
      : this._transloco.translate('chat.message.encrypted');
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
          message: this._transloco.translate('chat.message.deleteConfirm'),
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
