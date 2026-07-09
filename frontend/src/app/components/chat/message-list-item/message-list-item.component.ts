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
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';

import { Observable } from 'rxjs';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';

import {
  AnchoredPopoverDirective,
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

import {
  BookmarkAnchor,
  captureAnchor,
} from '@app/components/chat/bookmark-highlight/bookmark-anchor';
import {
  anchorFromRange,
  plainText,
} from '@app/components/chat/bookmark-highlight/bookmark-dom';
import { DocumentCardComponent } from '@app/components/chat/document-card/document-card.component';
import {
  MessageAttachmentChip,
  MessageAttachmentChipComponent,
} from '@app/components/chat/message-attachment-chip/message-attachment-chip.component';
import { MessageSources } from '@app/components/chat/message-sources/message-sources';
import { RedactedMarkdownComponent } from '@app/components/chat/redacted-markdown/redacted-markdown.component';
import { ConfirmationDialogComponent } from '@app/components/confirmation-dialog/confirmation-dialog.component';
import { segmentMessageContent } from '@app/documents/cog-doc/cog-doc-parser';
import { MessageSegment } from '@app/documents/cog-doc/cog-doc.types';
import { DocumentExportService } from '@app/documents/document-export.service';
import { DocFormat } from '@app/documents/document.types';
import { MemoryScope } from '@app/interfaces/compaction';
import { Message, isMessageFromUser } from '@app/interfaces/message';
import { Model } from '@app/interfaces/model';
import { Persona } from '@app/interfaces/persona';
import { containsRedactionToken } from '@app/redaction';
import { AuthService } from '@app/services/auth.service';
import { BookmarkService } from '@app/services/bookmark.service';
import { CompactionService } from '@app/services/compaction.service';
import { ConversationService } from '@app/services/conversation.service';
import { MessageService } from '@app/services/message.service';
import { ModelService } from '@app/services/model.service';
import { PersonaService } from '@app/services/persona.service';
import { PrivacyPanelService } from '@app/services/privacy-panel.service';
import { RedactionService } from '@app/services/redaction.service';
import { ScopedMemoryService } from '@app/services/scoped-memory.service';
import { UserPreferencesService } from '@app/services/user-preferences.service';
import { Citation, CitationAnchor } from '@app/utils/citations';
import { cognosDialogOptions } from '@app/utils/dialog-options';
import { privacyReceiptLine } from '@app/utils/privacy-copy';
import { effectiveRetentionDays } from '@app/utils/retention';
import { resolveServedModel } from '@app/utils/served-model';
import {
  StreamingMarkdownSplit,
  splitStreamingMarkdown,
} from '@app/utils/streaming-markdown';

@Component({
  selector: 'app-message-list-item',
  standalone: true,
  imports: [
    RedactedMarkdownComponent,
    DocumentCardComponent,
    MessageSources,
    MessageAttachmentChipComponent,
    ClipboardModule,
    NgTemplateOutlet,
    AnchoredPopoverDirective,
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
                  <div class="message-list-item__copy-menu" cogAnchoredPopover>
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

          @if (canDownload()) {
            <span class="message-list-item__download-wrap">
              <cog-icon-button
                name="download"
                [tone]="downloadFailed() ? 'danger' : undefined"
                [title]="
                  downloadFailed()
                    ? t('chat.message.documentRenderFailed')
                    : t('chat.message.download')
                "
                [selected]="downloadMenuOpen()"
                [disabled]="exporting()"
                (click)="toggleDownloadMenu($event)"
              />
              @if (downloadMenuOpen()) {
                <div class="message-list-item__download-menu" cogAnchoredPopover>
                  <cog-menu
                    [items]="downloadMenuItems()"
                    (itemSelect)="onDownloadSelect($event)"
                  />
                </div>
              }
            </span>
          }

          @if (message.expires) {
            <cog-icon-button
              name="pin"
              [title]="t('chat.message.keep')"
              (click)="onKeepMessage(message)"
            />
          }

          @if (
            !isMessageFromUser(message.decryptedData) && privacyReceipt();
            as receipt
          ) {
            <span class="message-list-item__privacy-wrap">
              <cog-icon-button
                name="shield-check"
                [title]="t('chat.privacy.seeDetails')"
                [selected]="privacyPopoverOpen()"
                (click)="togglePrivacyPopover($event)"
              />
              @if (privacyPopoverOpen()) {
                <div class="message-list-item__privacy-pop" cogAnchoredPopover>
                  <p class="message-list-item__privacy-text">{{ receipt }}</p>
                  <button
                    type="button"
                    class="message-list-item__privacy-details"
                    (click)="openPrivacyPanelFromPopover()"
                  >
                    {{ t('chat.privacy.seeDetails') }}
                  </button>
                </div>
              }
            </span>
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
              } @else {
                @if (fileChips().length) {
                  <div class="message-list-item__attachments">
                    @for (chip of fileChips(); track chip.attachmentId) {
                      <app-message-attachment-chip
                        [chip]="chip"
                        (download)="downloadAttachment($event)"
                      />
                    }
                  </div>
                }
                @if (message.decryptedData.content) {
                  <app-redacted-markdown
                    [content]="message.decryptedData.content"
                    [bookmarks]="bookmarksForMessage()"
                  />
                } @else if (!fileChips().length) {
                  <p class="message-list-item__empty">
                    {{ t('chat.message.empty') }}
                  </p>
                }
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
              @if (showSearching()) {
                <p
                  class="message-list-item__searching"
                  role="status"
                  aria-live="polite"
                >
                  <cog-icon name="search" [size]="14" class="is-spinning" />
                  {{ t('chat.message.searching') }}
                </p>
              }

              @if (citations().length) {
                <app-message-sources
                  class="message-list-item__sources"
                  [citations]="citations()"
                />
              }

              @if (hasReasoning()) {
                <div class="message-list-item__reasoning">
                  <button
                    type="button"
                    class="message-list-item__reasoning-toggle"
                    [attr.aria-expanded]="reasoningExpanded()"
                    (click)="toggleReasoning()"
                  >
                    <span
                      class="message-list-item__reasoning-icon"
                      [class.is-spinning]="message.isStreaming"
                      aria-hidden="true"
                    >
                      <cog-icon
                        [name]="message.isStreaming ? 'loader' : 'brain'"
                        [size]="14"
                      />
                    </span>
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
                        <!-- Progressive render, matching the answer body:
                             completed blocks render as markdown, the in-progress
                             tail stays plain text until its block closes. -->
                        @let reasoningSplit =
                          streamingSplit(message.decryptedData.reasoning);
                        @if (reasoningSplit.stable) {
                          <app-redacted-markdown [content]="reasoningSplit.stable" />
                        }
                        @if (reasoningSplit.tail) {
                          <p class="message-list-item__streaming">
                            {{ reasoningSplit.tail }}
                          </p>
                        }
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
                  <app-redacted-markdown
                    [content]="message.decryptedData.content"
                    [bookmarks]="bookmarksForMessage()"
                  />
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
                @let segments = messageSegments();
                @if (segments.length === 1 && segments[0].kind === 'markdown') {
                  <!-- The overwhelmingly common case (no <cog-doc> block): keep
                       today's render path byte-identical, including the
                       streaming/plain-text shortcut, spec §5.2. -->
                  @if (message.isStreaming) {
                    <!-- Progressive render: completed blocks (up to the last
                         blank-line boundary) render as markdown while the
                         in-progress block stays plain text. Citations are
                         withheld until completion — their anchor offsets index
                         the FULL content and won't match a partial prefix. -->
                    @let split = streamingSplit(message.decryptedData.content);
                    @if (split.stable) {
                      <app-redacted-markdown [content]="split.stable" />
                    }
                    @if (split.tail) {
                      <p class="message-list-item__streaming">
                        {{ hydrated(split.tail) }}
                      </p>
                    }
                  } @else {
                    <app-redacted-markdown
                      [content]="message.decryptedData.content"
                      [citations]="citations()"
                      [citationAnchors]="citationAnchors()"
                      [bookmarks]="bookmarksForMessage()"
                    />
                  }
                } @else {
                  <!--
                    A <cog-doc> block is present: render each segment in order.
                    Citation-anchor offsets index the FULL raw content, which no
                    longer matches any single segment's text, so inline citation
                    markers are suppressed here — the sources dropdown above
                    still lists every source (spec §5.2, web-search "never guess
                    anchor positions" rule).
                  -->
                  @for (segment of segments; track $index) {
                    @if (segment.kind === 'markdown') {
                      <app-redacted-markdown [content]="segment.text" />
                    } @else if (segment.block.state === 'invalid') {
                      <app-redacted-markdown [content]="segment.block.raw" />
                      <p class="message-list-item__document-note">
                        {{ t('chat.message.documentInvalid') }}
                      </p>
                    } @else {
                      <app-document-card [block]="segment.block" [message]="message" />
                    }
                  }
                }
              } @else if (message.isStreaming) {
                <!-- Still generating and nothing to show yet. A reasoning model
                     already signals activity via the "Thinking…" toggle, so only
                     show the typing indicator when there is no reasoning. -->
                @if (!hasReasoning()) {
                  <p
                    class="message-list-item__typing"
                    role="status"
                    [attr.aria-label]="t('chat.message.reasoningThinking')"
                  >
                    <span class="message-list-item__typing-dot"></span>
                    <span class="message-list-item__typing-dot"></span>
                    <span class="message-list-item__typing-dot"></span>
                  </p>
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
        @if (canAddToUserMemory()) {
          <button type="button" (click)="addSelectionToMemory('user', pop.text)">
            <cog-icon name="users" [size]="14" tone="current" />
            {{ t('chat.memory.addToUser') }}
          </button>
        }
        @if (bookmarkCandidate()) {
          <button type="button" (click)="saveBookmark()">
            <cog-icon name="pin" [size]="14" tone="current" />
            {{ t('chat.bookmark.save') }}
          </button>
        }
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
      gap: var(--cog-space-025);
      border: var(--cog-border-width) solid var(--cog-border);
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

    .message-list-item__attachments {
      display: flex;
      flex-direction: column;
      gap: var(--cog-space-100);
      margin-bottom: var(--cog-space-150);
    }

    .message-list-item__actions {
      display: flex;
      gap: var(--cog-space-050);
    }

    .message-list-item__copy-wrap {
      position: relative;
      display: inline-flex;
    }

    /* Position (fixed left/top) is owned by the cogAnchoredPopover directive,
       which flips/clamps the menu inside the viewport — so it opens upward near
       the composer instead of being clipped behind it. z-index clears the
       composer (matches the memory popover). */
    .message-list-item__copy-menu {
      position: fixed;
      z-index: 60;
    }

    .message-list-item__download-wrap {
      position: relative;
      display: inline-flex;
    }

    .message-list-item__download-menu {
      position: fixed;
      z-index: 60;
    }

    .message-list-item__privacy-wrap {
      position: relative;
      display: inline-flex;
    }

    .message-list-item__privacy-pop {
      position: fixed;
      z-index: 60;
      display: grid;
      gap: var(--cog-space-100);
      max-width: min(22rem, calc(100vw - var(--cog-space-400)));
      border: 1px solid var(--cog-border-subtle);
      border-radius: var(--cog-radius-md);
      background: var(--cog-surface-raised);
      padding: var(--cog-space-150);
      box-shadow: var(--cog-shadow-md);
    }

    .message-list-item__privacy-text {
      margin: 0;
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-caption);
      line-height: var(--cog-lh-caption);
    }

    .message-list-item__privacy-details {
      justify-self: start;
      border: 0;
      background: transparent;
      padding: 0;
      color: var(--cog-link);
      font: inherit;
      font-size: var(--cog-fs-caption);
      line-height: var(--cog-lh-caption);
      cursor: pointer;
    }

    .message-list-item__privacy-details:hover {
      text-decoration: underline;
    }

    .message-list-item__empty,
    .message-list-item__deleted {
      margin: 0;
      color: var(--cog-text-subtlest);
      font-style: italic;
    }

    .message-list-item__typing {
      display: inline-flex;
      align-items: center;
      gap: var(--cog-space-050);
      margin: 0;
      padding: var(--cog-space-050) 0;
    }

    .message-list-item__typing-dot {
      width: 6px;
      height: 6px;
      border-radius: var(--cog-radius-pill);
      background: var(--cog-text-subtlest);
      animation: message-typing 1.2s ease-in-out infinite;
    }

    .message-list-item__typing-dot:nth-child(2) {
      animation-delay: 0.2s;
    }

    .message-list-item__typing-dot:nth-child(3) {
      animation-delay: 0.4s;
    }

    @keyframes message-typing {
      0%,
      60%,
      100% {
        opacity: 0.25;
        transform: translateY(0);
      }
      30% {
        opacity: 1;
        transform: translateY(-2px);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .message-list-item__typing-dot {
        animation: none;
        opacity: 0.5;
      }
    }

    .message-list-item__streaming {
      margin: 0;
      white-space: pre-wrap;
    }

    .message-list-item__document-note {
      margin: 0;
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-body-sm);
      font-style: italic;
    }

    .message-list-item__searching {
      display: flex;
      align-items: center;
      gap: var(--cog-space-075);
      margin: 0 0 var(--cog-space-100);
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-body-sm);
    }

    .message-list-item__searching .is-spinning {
      display: inline-flex;
      animation: reasoning-spin 0.9s linear infinite;
    }

    @media (prefers-reduced-motion: reduce) {
      .message-list-item__searching .is-spinning {
        animation: none;
      }
    }

    .message-list-item__sources {
      display: block;
      margin-block-end: var(--cog-space-100);
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

    .message-list-item__reasoning-icon {
      display: inline-flex;
    }

    .message-list-item__reasoning-icon.is-spinning {
      animation: reasoning-spin 0.9s linear infinite;
    }

    @keyframes reasoning-spin {
      to {
        transform: rotate(360deg);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .message-list-item__reasoning-icon.is-spinning {
        animation: none;
      }
    }

    .message-list-item__reasoning-toggle:focus-visible {
      outline: var(--cog-border-width-strong) solid var(--cog-brand);
      outline-offset: var(--cog-border-width-strong);
      border-radius: var(--cog-radius-xs);
    }

    .message-list-item__reasoning-caret {
      width: 0;
      height: 0;
      border-block: 4px solid transparent;
      border-inline-start: 5px solid currentColor;
      transition: transform var(--cog-dur-fast) var(--cog-ease-standard);
    }

    .message-list-item__reasoning-caret.is-open {
      transform: rotate(90deg);
    }

    .message-list-item__reasoning-body {
      margin-block-start: var(--cog-space-050);
      padding-inline-start: var(--cog-space-100);
      border-inline-start: var(--cog-border-width-strong) solid var(--cog-border);
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
      border: var(--cog-border-width) solid var(--cog-border);
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
      outline: var(--cog-border-width-strong) solid var(--cog-brand);
      outline-offset: var(--cog-border-width);
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
  private readonly _authService = inject(AuthService);
  private readonly _privacyPanel = inject(PrivacyPanelService);
  private readonly _redactionService = inject(RedactionService);
  private readonly _compactionService = inject(CompactionService);
  private readonly _scopedMemory = inject(ScopedMemoryService);
  private readonly _bookmarkService = inject(BookmarkService);
  private readonly _userPreferences = inject(UserPreferencesService);
  private readonly _toast = inject(CognosToastService);
  private readonly _documentExport = inject(DocumentExportService);
  private readonly _cdr = inject(ChangeDetectorRef);
  private readonly _dialog = inject(Dialog);
  private readonly _transloco = inject(TranslocoService);
  private readonly _elementRef = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly _destroyRef = inject(DestroyRef);

  // Copy-options menu (only offered for messages containing redactions).
  readonly copyMenuOpen = signal(false);
  readonly privacyPopoverOpen = signal(false);

  // Reasoning disclosure: null means "follow the default" (open while the
  // response streams so the user sees thinking live, collapsed once complete);
  // an explicit boolean records the user's manual toggle and overrides that.
  private readonly _reasoningOverride = signal<boolean | null>(null);

  // Transient "copied" state: the copy icon becomes a green tick for a moment
  // after a successful copy, then reverts.
  readonly copied = signal(false);
  private _copiedTimer?: ReturnType<typeof setTimeout>;

  // Download-options menu (docx/pdf/markdown) offered on completed assistant
  // messages. `exporting` guards against overlapping renders (the worker call
  // is async); `downloadFailed` mirrors `copied` — a transient error state on
  // the same button, shown for a moment then reverted.
  readonly downloadMenuOpen = signal(false);
  readonly exporting = signal(false);
  readonly downloadFailed = signal(false);
  private _downloadFailedTimer?: ReturnType<typeof setTimeout>;

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(this._copiedTimer);
      clearTimeout(this._downloadFailedTimer);
    });
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

  // Resolved user-upload chips for the bubble (name + download, or a
  // removed/private cue). Hydrated lazily, keyed by record id.
  private readonly _fileChips = signal<MessageAttachmentChip[]>([]);
  private _chipsRecordId?: string;

  fileChips(): MessageAttachmentChip[] {
    return this._fileChips();
  }

  displayImageUrls(): string[] {
    const own = this.message?.imageUrls ?? [];
    return own.length ? own : this._lazyImageUrls();
  }

  imagesLoading(): boolean {
    return this._imagesLoading();
  }

  ngOnChanges(): void {
    const message = this.message;
    // Keep the record-id signal in sync so bookmarksForMessage() (a computed)
    // re-derives when this item is bound to a different message.
    this._recordId.set(message?.record_id);
    const attachments = message?.decryptedData.attachments ?? [];
    if (!message?.record_id || attachments.length === 0) {
      return;
    }

    // Resolve user-upload chips (name/download, or removed/private cue) once
    // per record. Independent of the generated-image path below.
    if (
      this._chipsRecordId !== message.record_id &&
      attachments.some((a) => a.kind === 'user_upload')
    ) {
      this._chipsRecordId = message.record_id;
      this._messageService
        .resolveAttachmentChips(message)
        .pipe(takeUntilDestroyed(this._destroyRef))
        .subscribe({
          next: (chips) => {
            this._fileChips.set(chips);
            this._cdr.markForCheck();
          },
          error: () => {
            /* leave chips empty on failure */
          },
        });
    }

    if (message.imageUrls?.length || this._hydratedRecordId === message.record_id) {
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

  // Download a resolved user-upload chip (fetch ciphertext, decrypt, save).
  downloadAttachment(chip: MessageAttachmentChip): void {
    this._messageService.downloadAttachmentChip(chip);
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
    const attachments = (this.message?.decryptedData.attachments ?? []).filter(
      (a) => !!a.sealed_key,
    );
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

  // Web-search sources cited by this assistant message (spec §4.1a). Empty for
  // messages that did not search.
  citations(): Citation[] {
    return this.message?.decryptedData.citations ?? [];
  }

  // Inline citation anchors positioning numbered markers in the answer body.
  // Empty when the provider gave no usable offsets → sources dropdown only.
  citationAnchors(): CitationAnchor[] {
    return this.message?.decryptedData.citation_anchors ?? [];
  }

  // Splits the assistant content into ordered markdown/document segments
  // (spec docs/specs/document-generation.md §5.2, §6). Called directly from the
  // template rather than cached in a signal: the parser has a single-scan fast
  // path for the overwhelmingly common "no <cog-doc> block" case, so
  // re-running it every change-detection pass is cheap.
  messageSegments(): MessageSegment[] {
    return segmentMessageContent(this.message?.decryptedData.content, {
      streaming: !!this.message?.isStreaming,
    });
  }

  // Splits streaming content into a complete-blocks prefix (rendered as
  // markdown) and an in-progress tail (shown as plain text). Called from the
  // template like messageSegments(): it's a cheap linear scan, and the stable
  // string only changes when a block completes, so the markdown component
  // re-renders once per block rather than once per token.
  streamingSplit(content?: string | null): StreamingMarkdownSplit {
    return splitStreamingMarkdown(content);
  }

  // The transient "Searching the web…" status shows only while streaming with a
  // search in progress and before any answer text — so a late activity event
  // (Vertex Gemini emits it after the answer) is a visual no-op (spec §4.4).
  showSearching(): boolean {
    return (
      !!this.message?.isStreaming &&
      !!this.message?.isSearching &&
      !this.message?.decryptedData.content
    );
  }

  // Collapsed by default (including while streaming) so live reasoning stays out
  // of the way; the user opens it explicitly. Their manual toggle wins.
  reasoningExpanded(): boolean {
    return this._reasoningOverride() ?? false;
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

  // Close the copy/download menus when clicking anywhere outside this message item.
  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent): void {
    if (
      !this.copyMenuOpen() &&
      !this.downloadMenuOpen() &&
      !this.privacyPopoverOpen()
    ) {
      return;
    }
    const target = event.target;
    if (target instanceof Node && !this._elementRef.nativeElement.contains(target)) {
      this.copyMenuOpen.set(false);
      this.downloadMenuOpen.set(false);
      this.privacyPopoverOpen.set(false);
    }
  }

  // A floating "Add to memory" action shown over a text selection inside this
  // message — mirrors the composer's redact popover (spec §8.2).
  readonly addToMemoryPopover = signal<{ x: number; y: number; text: string } | null>(
    null,
  );

  // The record id of the bound message, mirrored into a signal so
  // bookmarksForMessage() (a computed) tracks it (Input isn't reactive).
  private readonly _recordId = signal<string | undefined>(undefined);

  // A pending bookmark for the current selection: the text-quote anchor captured
  // against the message's rendered-markdown root. Set alongside the memory
  // popover, so the same floating menu offers "Save to bookmarks".
  readonly bookmarkCandidate = signal<BookmarkAnchor | null>(null);

  // The saved-bookmark anchors to paint over this message's main content. Reads
  // the bookmark cache so late-loaded bookmarks paint once decrypted.
  readonly bookmarksForMessage = computed<BookmarkAnchor[]>(() => {
    const id = this._recordId();
    if (!id) {
      return [];
    }
    return this._bookmarkService.forMessage(id).map((bookmark) => ({
      quote: bookmark.quote,
      prefix: bookmark.prefix,
      suffix: bookmark.suffix,
    }));
  });

  @HostListener('mouseup')
  onMouseUp(): void {
    if (!this.canAddToMemory()) {
      this.addToMemoryPopover.set(null);
      this.bookmarkCandidate.set(null);
      return;
    }
    const selection = window.getSelection();
    const text = selection?.toString().trim() ?? '';
    if (!text || !selection || selection.rangeCount === 0) {
      this.addToMemoryPopover.set(null);
      this.bookmarkCandidate.set(null);
      return;
    }
    // Only act on a selection that lives inside this message.
    const range = selection.getRangeAt(0);
    if (!this._elementRef.nativeElement.contains(range.commonAncestorContainer)) {
      this.addToMemoryPopover.set(null);
      this.bookmarkCandidate.set(null);
      return;
    }
    const rect = range.getBoundingClientRect();
    this.addToMemoryPopover.set({
      x: rect.left + rect.width / 2,
      y: rect.top,
      text,
    });
    this.bookmarkCandidate.set(this.captureBookmarkAnchor(range));
  }

  // captureBookmarkAnchor builds a text-quote anchor from the selection, rooted
  // at the closest app-redacted-markdown host so its offsets match the element
  // the highlight is later painted over. Requires a persisted message.
  private captureBookmarkAnchor(range: Range): BookmarkAnchor | null {
    if (!this.message?.record_id) {
      return null;
    }
    const root = this.markdownRootForRange(range);
    if (root) {
      return anchorFromRange(root, range);
    }

    const selectedText = range.toString().trim();
    if (!selectedText) {
      return null;
    }
    const candidates = Array.from(
      this._elementRef.nativeElement.querySelectorAll<HTMLElement>(
        'app-redacted-markdown',
      ),
    );
    for (const candidate of candidates) {
      const text = plainText(candidate);
      const start = text.indexOf(selectedText);
      if (start !== -1) {
        return captureAnchor(text, start, start + selectedText.length);
      }
    }
    return null;
  }

  private markdownRootForRange(range: Range): HTMLElement | null {
    const startRoot = this.markdownRootForNode(range.startContainer);
    const endRoot = this.markdownRootForNode(range.endContainer);
    if (startRoot && startRoot === endRoot) {
      return startRoot;
    }
    return null;
  }

  private markdownRootForNode(node: Node): HTMLElement | null {
    const element = node instanceof Element ? node : (node.parentElement ?? null);
    return element?.closest<HTMLElement>('app-redacted-markdown') ?? null;
  }

  // saveBookmark seals the pending anchor to the user's vault key and stores it,
  // toasting success/error. Clears the selection and popover on completion.
  saveBookmark(): void {
    const anchor = this.bookmarkCandidate();
    const conversation = this._conversationService.conversation();
    const messageId = this.message?.record_id;
    this.addToMemoryPopover.set(null);
    this.bookmarkCandidate.set(null);
    window.getSelection()?.removeAllRanges();
    if (!anchor || !conversation || !messageId) {
      return;
    }
    this._bookmarkService.create(conversation.record.id, messageId, anchor).subscribe({
      next: () =>
        this._toast.notify({
          title: this._transloco.translate('chat.bookmark.saved'),
        }),
      error: () =>
        this._toast.notify({
          title: this._transloco.translate('chat.bookmark.saveError'),
          tone: 'danger',
        }),
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
    this.bookmarkCandidate.set(null);
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

  // canAddToUserMemory reports whether the "User" scope option should appear —
  // only when personal memory is switched on (otherwise the write is a no-op).
  canAddToUserMemory(): boolean {
    return this._userPreferences.memoryEnabled();
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

  // A completed assistant message with content can be exported to a file
  // (spec docs/specs/document-generation.md §5.1). record_id is not required —
  // export works on any decrypted content, unlike regenerate/delete which need
  // a persisted record to act on.
  canDownload(): boolean {
    const message = this.message;
    return (
      !!message &&
      !isMessageFromUser(message.decryptedData) &&
      !message.isStreaming &&
      !message.decryptedData.deleted &&
      !!message.decryptedData.content
    );
  }

  downloadMenuItems(): CognosMenuItem[] {
    return [
      { title: this._transloco.translate('chat.message.downloadDocx') },
      { title: this._transloco.translate('chat.message.downloadPdf') },
      { title: this._transloco.translate('chat.message.downloadMarkdown') },
    ];
  }

  toggleDownloadMenu(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.downloadMenuOpen.update((open) => !open);
  }

  // Renders and downloads the message in the chosen format. `exporting` blocks
  // overlapping calls (the render worker call is async) rather than relying
  // solely on the disabled button, since the guard must hold even if it's
  // invoked programmatically.
  onDownloadSelect(index: number): void {
    this.downloadMenuOpen.set(false);
    const message = this.message;
    const format: DocFormat | undefined = (['docx', 'pdf', 'markdown'] as const)[index];
    if (!message || !format || this.exporting()) {
      return;
    }
    this.exporting.set(true);
    this._documentExport
      .downloadMessageAs(message, format)
      .catch(() => this.onDownloadFailed())
      .finally(() => {
        this.exporting.set(false);
        this._cdr.markForCheck();
      });
  }

  private onDownloadFailed(): void {
    this.downloadFailed.set(true);
    clearTimeout(this._downloadFailedTimer);
    this._downloadFailedTimer = setTimeout(() => {
      this.downloadFailed.set(false);
      this._cdr.markForCheck();
    }, 2000);
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

  // Per-answer privacy stats line for the hover shield popover, or null when it
  // shouldn't show (no message, still streaming, deleted, or nothing to attribute).
  // Prefers the served_* snapshot; falls back to the live catalogue via `this.model`.
  privacyReceipt(): string | null {
    const message = this.message;
    if (!message || message.isStreaming || message.decryptedData.deleted) {
      return null;
    }
    const served = resolveServedModel(message.decryptedData, this.model);
    if (!served) {
      return null;
    }
    const days = effectiveRetentionDays(
      this._conversationService.conversation()?.record.retention_days,
      this._authService.defaultRetentionDays(),
    );
    return privacyReceiptLine(served, days, (key, params) =>
      this._transloco.translate(key, params),
    );
  }

  togglePrivacyPopover(event: Event): void {
    event.preventDefault();
    event.stopPropagation();
    this.privacyPopoverOpen.update((open) => !open);
  }

  // Open the full per-chat privacy panel (rendered once, in the chat header).
  openPrivacyPanelFromPopover(): void {
    this.privacyPopoverOpen.set(false);
    this._privacyPanel.open();
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
