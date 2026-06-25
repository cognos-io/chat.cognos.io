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
  type OnChanges,
  effect,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { Observable } from 'rxjs';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';

import {
  CognosAssistantMessageComponent,
  CognosBranchSwitcherComponent,
  CognosButtonComponent,
  CognosIconButtonComponent,
  CognosIconComponent,
  CognosImageGridComponent,
  CognosLightboxComponent,
  CognosMenuComponent,
  type CognosMenuItem,
  CognosToastService,
  CognosUserMessageComponent,
  MessageBranchInfo,
} from '@cognos/ui-angular';

import { RedactedMarkdownComponent } from '@app/components/chat/redacted-markdown/redacted-markdown.component';
import { ConfirmationDialogComponent } from '@app/components/confirmation-dialog/confirmation-dialog.component';
import { MemoryScope } from '@app/interfaces/compaction';
import { Message, isMessageFromUser } from '@app/interfaces/message';
import { Model } from '@app/interfaces/model';
import { Persona } from '@app/interfaces/persona';
import { containsRedactionToken } from '@app/redaction';
import { CompactionService } from '@app/services/compaction.service';
import { ConversationService } from '@app/services/conversation.service';
import { MessageService } from '@app/services/message.service';
import { ModelService } from '@app/services/model.service';
import { PersonaService } from '@app/services/persona.service';
import { RedactionService } from '@app/services/redaction.service';
import { ScopedMemoryService } from '@app/services/scoped-memory.service';
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
    CognosIconComponent,
    CognosBranchSwitcherComponent,
    CognosButtonComponent,
    CognosImageGridComponent,
    CognosLightboxComponent,
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
              @if (hasReasoning()) {
                <div class="message-list-item__reasoning">
                  <button
                    type="button"
                    class="message-list-item__reasoning-toggle"
                    [attr.aria-expanded]="reasoningExpanded()"
                    (click)="toggleReasoning()"
                  >
                    <cog-icon name="brain" [size]="14" aria-hidden="true" />
                    {{ reasoningToggleLabel() }}
                    <span
                      class="message-list-item__reasoning-caret"
                      [class.is-open]="reasoningExpanded()"
                      aria-hidden="true"
                    ></span>
                  </button>
                  @if (reasoningExpanded()) {
                    <div class="message-list-item__reasoning-body" role="region">
                      @if (message.isStreaming) {
                        <p class="message-list-item__streaming">
                          {{ message.decryptedData.reasoning }}
                        </p>
                      } @else {
                        <app-redacted-markdown
                          [content]="message.decryptedData.reasoning ?? ''"
                        />
                      }
                      <p class="message-list-item__reasoning-note">
                        {{ t('chat.message.reasoningDisclaimer') }}
                      </p>
                    </div>
                  }
                </div>
              }

              @if (message.decryptedData.deleted) {
                <p class="message-list-item__deleted">
                  {{ t('chat.message.deleted') }}
                </p>
              } @else if (displayImageUrls().length) {
                @if (message.decryptedData.content) {
                  <app-redacted-markdown [content]="message.decryptedData.content" />
                }
                <cog-image-grid
                  [images]="displayImageUrls()"
                  [encryptedLabel]="t('chat.message.imageEncrypted')"
                  (open)="openLightbox($event)"
                />
              } @else if (imagesLoading()) {
                <p class="message-list-item__streaming">
                  {{ t('chat.message.imageLoading') }}
                </p>
              } @else if (hasUndecryptedImage()) {
                <p class="message-list-item__empty">
                  {{ t('chat.message.imageUnavailable') }}
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

    @if (lightboxUrl(); as src) {
      <ng-container *transloco="let t">
        <cog-lightbox
          [src]="src"
          [encryptedLabel]="t('chat.message.imageEncrypted')"
          [downloadLabel]="t('chat.message.imageDownload')"
          [closeLabel]="t('chat.message.imageClose')"
          (close)="closeLightbox()"
          (download)="downloadImage(src)"
        />
      </ng-container>
    }

    @if (addToMemoryPopover(); as pop) {
      <div
        *transloco="let t"
        class="message-list-item__memory-pop"
        [style.left.px]="pop.x"
        [style.top.px]="pop.y"
      >
        <span class="message-list-item__memory-pop-label">
          {{ t('chat.memory.addAction') }}
        </span>
        <button type="button" (click)="addSelectionToMemory('conversation', pop.text)">
          <cog-icon name="message-square" [size]="14" tone="current" />
          {{ t('chat.memory.addToConversation') }}
        </button>
        @if (canAddToProject()) {
          <button type="button" (click)="addSelectionToMemory('project', pop.text)">
            <cog-icon name="folder" [size]="14" tone="current" />
            {{ t('chat.memory.addToProject') }}
          </button>
        }
        <button type="button" (click)="addSelectionToMemory('user', pop.text)">
          <cog-icon name="users" [size]="14" tone="current" />
          {{ t('chat.memory.addToUser') }}
        </button>
      </div>
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

    /* Floating "Add to memory" menu shown over a text selection — mirrors the
       composer's redact popover, with one entry per memory scope. */
    .message-list-item__memory-pop {
      position: fixed;
      z-index: 60;
      transform: translate(-50%, calc(-100% - 8px));
      display: flex;
      flex-direction: column;
      gap: 2px;
      border: 1px solid var(--cog-border);
      border-radius: var(--cog-radius-md);
      background: var(--cog-surface);
      box-shadow: var(--cog-shadow-overlay);
      padding: var(--cog-space-050);
      color: var(--cog-text);
      font-size: var(--cog-fs-caption);
    }

    .message-list-item__memory-pop-label {
      padding: 2px var(--cog-space-100);
      color: var(--cog-text-subtle);
      font-weight: var(--cog-fw-semibold);
    }

    .message-list-item__memory-pop button {
      display: inline-flex;
      align-items: center;
      gap: var(--cog-space-050);
      border: 0;
      border-radius: var(--cog-radius-sm);
      background: transparent;
      padding: var(--cog-space-050) var(--cog-space-100);
      color: var(--cog-text);
      font: inherit;
      font-weight: var(--cog-fw-semibold);
      text-align: left;
      white-space: nowrap;
      cursor: pointer;
    }

    .message-list-item__memory-pop button:hover {
      background: var(--cog-surface-hover);
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

    .message-list-item__reasoning {
      margin-block-end: var(--cog-space-100);
    }

    .message-list-item__reasoning-toggle {
      display: inline-flex;
      align-items: center;
      gap: var(--cog-space-050);
      border: 0;
      background: none;
      padding: var(--cog-space-025) 0;
      color: var(--cog-text-subtlest);
      font: inherit;
      font-size: var(--cog-fs-body-sm);
      cursor: pointer;
    }

    .message-list-item__reasoning-toggle:hover {
      color: var(--cog-text-subtle);
    }

    .message-list-item__reasoning-toggle:focus-visible {
      outline: 2px solid var(--cog-brand);
      outline-offset: 2px;
      border-radius: var(--cog-radius-xs);
    }

    .message-list-item__reasoning-caret {
      width: 0;
      height: 0;
      border-block: 4px solid transparent;
      border-inline-start: 5px solid currentColor;
      transition: transform 120ms ease;
    }

    .message-list-item__reasoning-caret.is-open {
      transform: rotate(90deg);
    }

    .message-list-item__reasoning-body {
      margin-block-start: var(--cog-space-050);
      padding-inline-start: var(--cog-space-100);
      border-inline-start: 2px solid var(--cog-border);
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-body-sm);
    }

    .message-list-item__reasoning-note {
      margin-block: var(--cog-space-100) 0;
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-body-sm);
      font-style: italic;
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
export class MessageListItemComponent implements OnChanges {
  private readonly _modelService = inject(ModelService);
  private readonly _personaService = inject(PersonaService);
  private readonly _messageService = inject(MessageService);
  private readonly _conversationService = inject(ConversationService);
  private readonly _redactionService = inject(RedactionService);
  private readonly _compactionService = inject(CompactionService);
  private readonly _scopedMemory = inject(ScopedMemoryService);
  private readonly _toast = inject(CognosToastService);
  private readonly _cdr = inject(ChangeDetectorRef);
  private readonly _dialog = inject(Dialog);
  private readonly _transloco = inject(TranslocoService);
  private readonly _elementRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly _destroyRef = inject(DestroyRef);

  // Copy-options menu (only offered for messages containing redactions).
  readonly copyMenuOpen = signal(false);

  // Reasoning disclosure: null means "follow the default" (open while the
  // response streams so the user sees thinking live, collapsed once complete);
  // an explicit boolean records the user's manual toggle and overrides that.
  private readonly _reasoningOverride = signal<boolean | null>(null);

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

  // Full-resolution viewer state for generated images.
  readonly lightboxUrl = signal<string | null>(null);

  // Object URLs for the message's images. The live generation path sets
  // message.imageUrls directly; on conversation reload we decrypt lazily into
  // these signals.
  private readonly _lazyImageUrls = signal<string[]>([]);
  private readonly _imagesLoading = signal(false);
  // record_id we've already hydrated, so re-renders don't refetch.
  private _hydratedRecordId?: string;

  displayImageUrls(): string[] {
    const own = this.message?.imageUrls ?? [];
    return own.length ? own : this._lazyImageUrls();
  }

  imagesLoading(): boolean {
    return this._imagesLoading();
  }

  ngOnChanges(): void {
    const message = this.message;
    const attachments = message?.decryptedData.attachments ?? [];
    if (
      !message?.record_id ||
      attachments.length === 0 ||
      message.imageUrls?.length ||
      this._hydratedRecordId === message.record_id
    ) {
      return;
    }

    this._hydratedRecordId = message.record_id;
    this._imagesLoading.set(true);
    this._messageService
      .decryptMessageImages(message)
      .pipe(takeUntilDestroyed(this._destroyRef))
      .subscribe({
        next: (urls) => {
          this._lazyImageUrls.set(urls);
          this._imagesLoading.set(false);
          this._cdr.markForCheck();
        },
        error: () => {
          this._imagesLoading.set(false);
          this._cdr.markForCheck();
        },
      });
  }

  openLightbox(index: number): void {
    const url = this.displayImageUrls()[index];
    if (url) {
      this.lightboxUrl.set(url);
    }
  }

  closeLightbox(): void {
    this.lightboxUrl.set(null);
  }

  // Save the decrypted image (a blob: URL) to disk at full resolution.
  downloadImage(url: string): void {
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = 'cognos-image.png';
    anchor.click();
  }

  // True when an assistant message references a generated image but no decrypted
  // bytes are available and we're not still loading — a non-sensitive error
  // state instead of an empty bubble.
  hasUndecryptedImage(): boolean {
    const attachments = this.message?.decryptedData.attachments ?? [];
    return (
      attachments.length > 0 &&
      !this.displayImageUrls().length &&
      !this._imagesLoading()
    );
  }

  // True when this assistant message carries provider reasoning text to surface.
  hasReasoning(): boolean {
    const reasoning = this.message?.decryptedData.reasoning;
    return !!reasoning && reasoning.trim() !== '';
  }

  // Open while streaming (live thinking), collapsed once complete, unless the
  // user has manually toggled the disclosure.
  reasoningExpanded(): boolean {
    return this._reasoningOverride() ?? !!this.message?.isStreaming;
  }

  toggleReasoning(): void {
    this._reasoningOverride.set(!this.reasoningExpanded());
  }

  reasoningToggleLabel(): string {
    if (this.message?.isStreaming) {
      return this._transloco.translate('chat.message.reasoningThinking');
    }
    return this._transloco.translate(
      this.reasoningExpanded()
        ? 'chat.message.reasoningHide'
        : 'chat.message.reasoningShow',
    );
  }

  // hydrated swaps placeholder tokens back to their originals for display only.
  // Stored content stays redacted; unknown tokens render as-is.
  hydrated(content?: string | null): string {
    if (!content) {
      return '';
    }
    const conversation = this._conversationService.conversation();
    return this._redactionService.hydrate(
      conversation?.record.id,
      content,
      conversation?.record.project,
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

  // A floating "Add to memory" action shown over a text selection inside this
  // message — mirrors the composer's redact popover (spec §8.2).
  readonly addToMemoryPopover = signal<{ x: number; y: number; text: string } | null>(
    null,
  );

  @HostListener('mouseup')
  onMouseUp(): void {
    if (!this.canAddToMemory()) {
      this.addToMemoryPopover.set(null);
      return;
    }
    const selection = window.getSelection();
    const text = selection?.toString().trim() ?? '';
    if (!text || !selection || selection.rangeCount === 0) {
      this.addToMemoryPopover.set(null);
      return;
    }
    // Only act on a selection that lives inside this message.
    const range = selection.getRangeAt(0);
    if (!this._elementRef.nativeElement.contains(range.commonAncestorContainer)) {
      this.addToMemoryPopover.set(null);
      return;
    }
    const rect = range.getBoundingClientRect();
    this.addToMemoryPopover.set({
      x: rect.left + rect.width / 2,
      y: rect.top,
      text,
    });
  }

  @HostListener('document:mousedown', ['$event'])
  onDocumentMouseDown(event: MouseEvent): void {
    if (!this.addToMemoryPopover()) {
      return;
    }
    const target = event.target as HTMLElement | null;
    // Keep the popover open when the click is the action button itself.
    if (target?.closest('.message-list-item__memory-pop')) {
      return;
    }
    this.addToMemoryPopover.set(null);
  }

  // canAddToMemory gates the popover: a persisted conversation the user can
  // encrypt to. Project conversations are allowed (they additionally offer the
  // project scope).
  private canAddToMemory(): boolean {
    const conversation = this._conversationService.conversation();
    return (
      !!conversation &&
      !this._conversationService.isTemporaryConversation() &&
      !!conversation.keyPair
    );
  }

  // canAddToProject reports whether the project-memory option should appear —
  // only when the conversation belongs to a project.
  canAddToProject(): boolean {
    return (
      this.canAddToMemory() &&
      !!this._conversationService.conversation()?.record.project
    );
  }

  // addSelectionToMemory re-redacts the selected snippet (so no plaintext PII is
  // stored) and pins it to the chosen memory scope: conversation, project, or
  // user (spec §16).
  addSelectionToMemory(scope: MemoryScope, text: string): void {
    const conversation = this._conversationService.conversation();
    this.addToMemoryPopover.set(null);
    window.getSelection()?.removeAllRanges();
    if (!conversation) {
      return;
    }
    const conversationId = conversation.record.id;
    const projectId = conversation.record.project;

    // Re-redact in the TARGET scope so no plaintext PII is stored and the
    // placeholder hydrates wherever that scope is shown (spec §16).
    let snippet = text;
    if (this._redactionService.enabled()) {
      snippet = this.redactForScope(scope, text, conversation, projectId);
    }

    let write$: Observable<unknown>;
    if (scope === 'user') {
      write$ = this._scopedMemory.addUserFact(snippet);
    } else if (scope === 'project' && projectId) {
      write$ = this._scopedMemory.addProjectFact(projectId, snippet);
    } else {
      write$ = this._compactionService.addManualFact(
        conversationId,
        snippet,
        conversation.keyPair,
      );
    }

    write$.subscribe({
      next: () =>
        this._toast.notify({ title: this._transloco.translate('chat.memory.added') }),
      error: () =>
        this._toast.notify({
          title: this._transloco.translate('chat.memory.addError'),
          tone: 'danger',
        }),
    });
  }

  // redactForScope re-redacts the snippet against the chosen scope's token map
  // and persists any new mappings there (best-effort), returning the placeholder
  // text to store in that scope's memory.
  private redactForScope(
    scope: MemoryScope,
    text: string,
    conversation: NonNullable<ReturnType<ConversationService['conversation']>>,
    projectId: string | undefined,
  ): string {
    const swallow = { error: () => undefined };
    if (scope === 'user') {
      const { redactedText, newEntries } =
        this._redactionService.prepareUserRedaction(text);
      if (newEntries.length > 0) {
        this._redactionService.persistUserRedaction(newEntries).subscribe(swallow);
      }
      return redactedText;
    }
    if (scope === 'project' && projectId) {
      const { redactedText, newEntries } =
        this._redactionService.prepareProjectRedaction(projectId, text);
      if (newEntries.length > 0) {
        this._redactionService
          .persistProjectRedaction(projectId, newEntries)
          .subscribe(swallow);
      }
      return redactedText;
    }
    const source = {
      kind: 'message' as const,
      id: this.message?.record_id ?? conversation.record.id,
    };
    const { redactedText, newEntries } = this._redactionService.prepareRedaction(
      conversation.record.id,
      text,
      undefined,
      source,
    );
    if (newEntries.length > 0) {
      this._redactionService
        .persist(conversation, newEntries, source)
        .subscribe(swallow);
    }
    return redactedText;
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
