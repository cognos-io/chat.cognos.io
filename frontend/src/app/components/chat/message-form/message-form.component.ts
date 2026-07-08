import { A11yModule } from '@angular/cdk/a11y';
import { OverlayModule } from '@angular/cdk/overlay';
import { CdkTextareaAutosize } from '@angular/cdk/text-field';
import { isPlatformBrowser } from '@angular/common';
import {
  Component,
  ElementRef,
  HostListener,
  PLATFORM_ID,
  computed,
  effect,
  inject,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import {
  FormBuilder,
  FormControl,
  ReactiveFormsModule,
  Validators,
} from '@angular/forms';
import { Router } from '@angular/router';

import { debounceTime, forkJoin } from 'rxjs';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';

import {
  CognosButtonComponent,
  CognosDialogActionsComponent,
  CognosDialogSurfaceComponent,
  CognosIconButtonComponent,
  CognosIconComponent,
  CognosRedactedTextComponent,
  type CognosRedactedTextKind,
  type CognosRedactedTextLabels,
  CognosToastService,
} from '@cognos/ui-angular';

import {
  ACCEPTED_ATTACHMENT_ACCEPT,
  extractClipboardFiles,
  isImageFile,
} from '@app/attachments/attachment-accept';
import {
  AttachmentLibraryService,
  LibraryFile,
} from '@app/attachments/attachment-library.service';
import { AttachmentProcessingService } from '@app/attachments/attachment-processing.service';
import { LibraryPickerComponent } from '@app/attachments/library-picker/library-picker-dialog.component';
import { PersonaAvatarComponent } from '@app/components/personas/persona-avatar/persona-avatar.component';
import {
  RedactionCandidate,
  buildCustomCandidates,
  candidateKey,
  resolveOverlaps,
  tokenTypeCode,
} from '@app/redaction';
import { AuthService } from '@app/services/auth.service';
import { BillingService } from '@app/services/billing.service';
import { ComposerToolsService } from '@app/services/composer-tools.service';
import { ConversationService } from '@app/services/conversation.service';
import { DeviceService } from '@app/services/device.service';
import {
  MessageRequest,
  MessageService,
  MessageStatus,
} from '@app/services/message.service';
import { ModelService } from '@app/services/model.service';
import { PersonaService } from '@app/services/persona.service';
import { RedactionService } from '@app/services/redaction.service';
import { VaultService } from '@app/services/vault.service';
import { QuickFilter } from '@app/utils/model-discovery';

import { redactionKindFor, redactionModalLabels } from '../redaction-ui';
import { ComposerToolsComponent } from './composer-tools/composer-tools.component';
import { ModelSelectorComponent } from './model-selector/model-selector.component';
import { PersonaChipsComponent } from './persona-chips/persona-chips.component';
import { PersonaSwitcherComponent } from './persona-switcher/persona-switcher.component';

// Escape text before placing it in the highlight overlay's innerHTML; only the
// <mark> tags we add are meant to be markup.
function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

@Component({
  selector: 'app-message-form',
  standalone: true,
  imports: [
    ReactiveFormsModule,
    CdkTextareaAutosize,
    A11yModule,
    OverlayModule,
    CognosButtonComponent,
    CognosDialogActionsComponent,
    CognosDialogSurfaceComponent,
    CognosIconButtonComponent,
    CognosIconComponent,
    CognosRedactedTextComponent,
    ComposerToolsComponent,
    ModelSelectorComponent,
    PersonaSwitcherComponent,
    PersonaChipsComponent,
    PersonaAvatarComponent,
    LibraryPickerComponent,
    TranslocoModule,
  ],
  template: `
    <form
      class="message-form"
      [class.message-form--drag-over]="attachmentDragOver()"
      [formGroup]="messageForm"
      (submit)="onSubmit()"
      (keydown.escape)="onComposerEscape($event)"
      (dragover)="onAttachmentDragOver($event)"
      (dragleave)="onAttachmentDragLeave($event)"
      (drop)="onAttachmentDrop($event)"
      *transloco="let t"
    >
      @if (auth.needsEmailVerification()) {
        <div class="message-form__locked-wrap">
          <div class="message-form__locked" role="status">
            <span class="message-form__locked-icon">
              <cog-icon name="mail" [size]="18" tone="text-subtle" />
            </span>
            <span class="message-form__locked-copy">
              <span class="message-form__locked-title">{{
                t('chat.composer.verify.title')
              }}</span>
              <span class="message-form__locked-body">
                {{ t('chat.composer.verify.body', { email: auth.email() }) }}
              </span>
            </span>
            <span class="message-form__locked-actions">
              <cog-button
                appearance="primary"
                icon="mail"
                type="button"
                [disabled]="emailResending()"
                (click)="resendVerification()"
              >
                {{
                  emailResending()
                    ? t('chat.composer.verify.resending')
                    : t('chat.composer.verify.resend')
                }}
              </cog-button>
            </span>
          </div>
        </div>
      } @else if (billing.isSendingLocked()) {
        <div class="message-form__locked-wrap">
          <div class="message-form__locked" role="status">
            <span class="message-form__locked-icon">
              <cog-icon name="lock" [size]="18" tone="text-subtle" />
            </span>
            <span class="message-form__locked-copy">
              <span class="message-form__locked-title">{{
                t('chat.composer.locked.title')
              }}</span>
              <span class="message-form__locked-body">
                {{ t('chat.composer.locked.body') }}
              </span>
            </span>
            <span class="message-form__locked-actions">
              <cog-button appearance="default" type="button" (click)="goToBilling()">
                {{ t('chat.composer.locked.comparePlans') }}
              </cog-button>
              <cog-button
                appearance="primary"
                icon="chevron-right"
                type="button"
                (click)="goToBilling()"
              >
                {{ t('chat.composer.locked.upgrade') }}
              </cog-button>
            </span>
          </div>
          <p class="message-form__locked-note">
            <cog-icon name="shield-check" [size]="14" tone="text-subtle" />
            {{ t('chat.composer.locked.guarantee') }}
          </p>
        </div>
      } @else {
        @if (showPersonaChips()) {
          <app-persona-chips />
        }

        <div class="message-form__panel">
          <label class="message-form__label" for="message-form">
            {{ t('chat.composer.label') }}
          </label>

          <input
            #attachmentInput
            type="file"
            class="message-form__file-input"
            [accept]="attachmentAccept"
            multiple
            hidden
            (change)="onAttachmentInputChange($event)"
          />

          @if (attachments.attachments().length > 0) {
            <ul class="message-form__attachments" data-testid="attachment-chips">
              @for (att of attachments.attachments(); track att.localId) {
                <li
                  class="message-form__chip"
                  [class.message-form__chip--failed]="att.state === 'failed'"
                  data-testid="attachment-chip"
                >
                  <cog-icon name="file-text" [size]="14" tone="text-subtle" />
                  <span class="message-form__chip-name" [title]="att.fileName">{{
                    att.fileName
                  }}</span>
                  @if (att.state === 'ready') {
                    <span class="message-form__chip-size">{{
                      formatAttachmentSize(att.sizeBytes)
                    }}</span>
                    @if (att.contextTruncated) {
                      <span
                        class="message-form__chip-truncated"
                        [title]="t('chat.composer.attachments.truncatedHint')"
                        data-testid="attachment-truncated"
                      >
                        <cog-icon
                          name="triangle-alert"
                          [size]="12"
                          tone="text-subtle"
                        />
                        {{ t('chat.composer.attachments.truncated') }}
                      </span>
                    }
                  } @else if (att.state === 'failed') {
                    <span class="message-form__chip-status">{{
                      attachmentErrorLabel(att.errorCode)
                    }}</span>
                  } @else {
                    <span class="message-form__chip-status">{{
                      attachmentStateLabel(att.state)
                    }}</span>
                  }
                  <button
                    type="button"
                    class="message-form__chip-remove"
                    [attr.aria-label]="
                      t('chat.composer.attachments.remove', { name: att.fileName })
                    "
                    (click)="removeAttachment(att.localId)"
                  >
                    <cog-icon name="x" [size]="14" />
                  </button>
                </li>
              }
            </ul>
          }

          @if (composerTools.autoSwitchNotice(); as notice) {
            <div class="message-form__model-switch" role="status">
              <cog-icon name="rotate-cw" [size]="14" tone="text-subtle" />
              <span class="message-form__model-switch-copy">
                {{
                  t(
                    notice.direction === 'to_image'
                      ? 'chat.composer.modelSwitch.toImage'
                      : 'chat.composer.modelSwitch.toText',
                    { model: notice.modelName }
                  )
                }}
                @if (notice.tierChanged) {
                  <span class="message-form__model-switch-tier">
                    {{
                      t('chat.composer.modelSwitch.tierChange', {
                        region: t('account.dataProcessing.regionBadge.' + notice.tier),
                      })
                    }}
                  </span>
                }
              </span>
              <button
                type="button"
                class="message-form__model-switch-dismiss"
                [attr.aria-label]="t('chat.composer.modelSwitch.dismiss')"
                (click)="composerTools.dismissAutoSwitch()"
              >
                <cog-icon name="x" [size]="14" />
              </button>
            </div>
          }

          @if (attachmentNotice()) {
            <p class="message-form__attachment-notice" role="status">
              {{ attachmentNotice() }}
            </p>
          }

          <div
            class="message-form__editor"
            [class.message-form__editor--highlight]="highlightRedactions()"
          >
            @if (highlightRedactions()) {
              <div
                #redactionHighlights
                class="message-form__highlights"
                aria-hidden="true"
                [innerHTML]="redactionHighlightHtml()"
              ></div>
            }

            <textarea
              cdkTextareaAutosize
              cdkAutosizeMaxRows="8"
              cdkAutosizeMinRows="2"
              class="message-form__textarea"
              formControlName="content"
              id="message-form"
              name="message-form"
              [placeholder]="t('chat.composer.placeholder')"
              [readOnly]="isStreaming()"
              (keydown.enter)="onEnterKey($event)"
              (keydown.control.enter)="isMac ? undefined : sendMessage()"
              (keydown.meta.enter)="isMac ? sendMessage() : undefined"
              (mouseup)="onComposerMouseUp($event)"
              (contextmenu)="onComposerContextMenu($event)"
              (paste)="onComposerPaste($event)"
              (input)="redactPopover.set(null)"
              (scroll)="onComposerScroll($event)"
            ></textarea>
          </div>

          <!-- Selection action: redact the highlighted text manually. Anchored
               to the pointer; clears when the selection or draft changes. -->
          @if (redactPopover(); as pop) {
            <button
              type="button"
              class="message-form__redact-pop"
              [style.left.px]="pop.x"
              [style.top.px]="pop.y"
              (click)="addCustomRedaction(pop.text)"
            >
              <cog-icon name="shield-check" [size]="14" tone="current" />
              {{ t('chat.composer.redaction.redactAction') }}
            </button>
          }

          @if (hasRedactionPreview()) {
            <div class="message-form__redaction">
              <div class="message-form__redaction-head">
                <button
                  type="button"
                  class="message-form__redaction-summary"
                  [attr.aria-expanded]="redactionPreviewOpen()"
                  (click)="toggleRedactionPreview()"
                >
                  <cog-icon name="shield-check" [size]="14" tone="text-subtle" />
                  <span>
                    @if (redactionActiveCount() > 0) {
                      {{
                        t('chat.composer.redaction.summary', {
                          count: redactionActiveCount(),
                        })
                      }}
                    } @else {
                      {{ t('chat.composer.redaction.none') }}
                    }
                  </span>
                  <cog-icon
                    [name]="redactionPreviewOpen() ? 'chevron-down' : 'chevron-right'"
                    [size]="14"
                    tone="text-subtle"
                  />
                </button>

                <cog-icon-button
                  [name]="highlightRedactions() ? 'eye' : 'eye-off'"
                  [title]="
                    highlightRedactions()
                      ? t('chat.composer.redaction.hideHighlight')
                      : t('chat.composer.redaction.showHighlight')
                  "
                  [selected]="highlightRedactions()"
                  (click)="highlightRedactions.set(!highlightRedactions())"
                />
              </div>

              @if (redactionPreviewOpen()) {
                <ul class="message-form__redaction-list">
                  @for (item of redactionCandidates(); track redactionKeyOf(item)) {
                    <li
                      class="message-form__redaction-item"
                      [class.message-form__redaction-item--off]="!isRedacted(item)"
                    >
                      <cog-redacted-text
                        [value]="item.value"
                        [placeholder]="redactionPlaceholder(item)"
                        [kind]="redactionKind(item)"
                        [label]="t('chat.composer.redaction.types.' + item.type)"
                        [labels]="modalLabels()"
                        [showSettings]="false"
                      />
                      <label class="message-form__redaction-toggle">
                        <input
                          type="checkbox"
                          [checked]="isRedacted(item)"
                          (change)="toggleRedaction(item)"
                        />
                        {{ t('chat.composer.redaction.redact') }}
                      </label>
                    </li>
                  }

                  @for (custom of activeCustomRedactions(); track custom) {
                    <li class="message-form__redaction-item">
                      <cog-redacted-text
                        [value]="custom"
                        placeholder="[[PII_CUSTOM]]"
                        kind="custom"
                        [label]="t('chat.composer.redaction.types.custom')"
                        [labels]="modalLabels()"
                        [showSettings]="false"
                      />
                      <button
                        type="button"
                        class="message-form__redaction-remove"
                        (click)="removeCustomRedaction(custom)"
                      >
                        {{ t('chat.composer.redaction.remove') }}
                      </button>
                    </li>
                  }

                  @for (remembered of rememberedCustomRedactions(); track remembered) {
                    <li class="message-form__redaction-item">
                      <cog-redacted-text
                        [value]="remembered"
                        placeholder="[[PII_CUSTOM]]"
                        kind="custom"
                        [label]="t('chat.composer.redaction.types.custom')"
                        [labels]="modalLabels()"
                        [showSettings]="false"
                      />
                      <span class="message-form__redaction-remembered">
                        {{ t('chat.composer.redaction.remembered') }}
                      </span>
                    </li>
                  }
                </ul>
              }
            </div>
          }

          <div class="message-form__controls">
            <cog-button
              #modelTrigger="cdkOverlayOrigin"
              cdkOverlayOrigin
              class="message-form__model"
              appearance="subtle"
              iconAfter="chevron-down"
              type="button"
              (click)="toggleModelSelector()"
            >
              {{ modelService.selectedModel().displayName }}
            </cog-button>

            @if (!isMobile()) {
              <!-- Desktop: dropdown anchored to the trigger. -->
              <ng-template
                cdkConnectedOverlay
                [cdkConnectedOverlayOrigin]="modelTrigger"
                [cdkConnectedOverlayOpen]="modelSelectorOpen()"
                [cdkConnectedOverlayHasBackdrop]="true"
                cdkConnectedOverlayBackdropClass="cdk-overlay-transparent-backdrop"
                [cdkConnectedOverlayPositions]="modelSelectorPositions"
                [cdkConnectedOverlayPush]="true"
                (backdropClick)="closeModelSelector()"
                (detach)="closeModelSelector()"
                (overlayKeydown)="onOverlayKeydown($event)"
              >
                <app-model-selector
                  layout="dropdown"
                  [requiredCapability]="composerTools.requiredCapability()"
                  [filterOverride]="modelFilterOverride()"
                  (modelSelected)="closeModelSelector()"
                  (closed)="closeModelSelector()"
                ></app-model-selector>
              </ng-template>
            } @else if (modelSelectorOpen()) {
              <!-- Mobile: full-width bottom sheet (spec §4.5). -->
              <div
                class="model-sheet-backdrop"
                (click)="closeModelSelector()"
                aria-hidden="true"
              ></div>
              <div
                class="model-sheet"
                role="dialog"
                aria-modal="true"
                cdkTrapFocus
                [cdkTrapFocusAutoCapture]="true"
              >
                <app-model-selector
                  layout="sheet"
                  [requiredCapability]="composerTools.requiredCapability()"
                  [filterOverride]="modelFilterOverride()"
                  (modelSelected)="closeModelSelector()"
                  (closed)="closeModelSelector()"
                ></app-model-selector>
              </div>
            }

            @if (modelService.selectedModel().reasoningEfforts.length) {
              <cog-button
                #reasoningTrigger="cdkOverlayOrigin"
                cdkOverlayOrigin
                class="message-form__reasoning"
                appearance="subtle"
                icon="brain"
                iconAfter="chevron-down"
                type="button"
                [title]="t('chat.composer.reasoning.title')"
                [attr.aria-label]="
                  t('chat.composer.reasoning.title') +
                  ': ' +
                  reasoningEffortLabel(modelService.selectedReasoningEffort())
                "
                [attr.aria-expanded]="reasoningMenuOpen()"
                (click)="toggleReasoningMenu()"
              >
                <span class="message-form__reasoning-trigger">
                  <cog-icon
                    [name]="reasoningEffortIcon(modelService.selectedReasoningEffort())"
                    [size]="16"
                    aria-hidden="true"
                  />
                </span>
              </cog-button>

              <ng-template
                cdkConnectedOverlay
                [cdkConnectedOverlayOrigin]="reasoningTrigger"
                [cdkConnectedOverlayOpen]="reasoningMenuOpen()"
                [cdkConnectedOverlayHasBackdrop]="true"
                cdkConnectedOverlayBackdropClass="cdk-overlay-transparent-backdrop"
                [cdkConnectedOverlayPositions]="modelSelectorPositions"
                [cdkConnectedOverlayPush]="true"
                (backdropClick)="closeReasoningMenu()"
                (detach)="closeReasoningMenu()"
                (overlayKeydown)="onOverlayKeydown($event)"
              >
                <div class="message-form__reasoning-menu" role="menu">
                  <p class="message-form__reasoning-menu-heading">
                    {{ t('chat.composer.reasoning.title') }}
                  </p>
                  @for (
                    effort of modelService.selectedModel().reasoningEfforts;
                    track effort;
                    let i = $index
                  ) {
                    <button
                      type="button"
                      role="menuitemradio"
                      class="message-form__reasoning-option"
                      [class.is-selected]="
                        effort === modelService.selectedReasoningEffort()
                      "
                      [attr.aria-checked]="
                        effort === modelService.selectedReasoningEffort()
                      "
                      (click)="onReasoningEffortSelect(i)"
                    >
                      <cog-icon
                        class="message-form__reasoning-option-icon"
                        [name]="reasoningEffortIcon(effort)"
                        [size]="18"
                        aria-hidden="true"
                      />
                      <span class="message-form__reasoning-option-text">
                        <span class="message-form__reasoning-option-label">
                          {{ reasoningEffortLabel(effort) }}
                        </span>
                        @if (reasoningEffortDescription(effort); as desc) {
                          <span class="message-form__reasoning-option-desc">{{
                            desc
                          }}</span>
                        }
                      </span>
                      @if (effort === modelService.selectedReasoningEffort()) {
                        <cog-icon
                          class="message-form__reasoning-option-check"
                          name="check"
                          [size]="16"
                          aria-hidden="true"
                        />
                      }
                    </button>
                  }
                </div>
              </ng-template>
            }

            <button
              #personaTrigger="cdkOverlayOrigin"
              cdkOverlayOrigin
              type="button"
              class="message-form__persona"
              [title]="
                t('chat.composer.switchPersona', {
                  name: personaService.selectedPersona().name,
                })
              "
              (click)="togglePersonaSwitcher()"
            >
              <app-persona-avatar
                [icon]="personaService.selectedPersona().icon"
                [color]="personaService.selectedPersona().color"
                [size]="20"
              />
              <span class="message-form__persona-name">
                {{ personaService.selectedPersona().name }}
              </span>
              <cog-icon name="chevron-down" [size]="14" tone="text-subtle" />
            </button>

            <ng-template
              cdkConnectedOverlay
              [cdkConnectedOverlayOrigin]="personaTrigger"
              [cdkConnectedOverlayOpen]="personaSwitcherOpen()"
              [cdkConnectedOverlayHasBackdrop]="true"
              cdkConnectedOverlayBackdropClass="cdk-overlay-transparent-backdrop"
              [cdkConnectedOverlayPositions]="modelSelectorPositions"
              [cdkConnectedOverlayPush]="true"
              (backdropClick)="closePersonaSwitcher()"
              (detach)="closePersonaSwitcher()"
              (overlayKeydown)="onPersonaOverlayKeydown($event)"
            >
              <app-persona-switcher
                (personaSelected)="closePersonaSwitcher()"
                (managed)="closePersonaSwitcher()"
              ></app-persona-switcher>
            </ng-template>

            <cog-button
              #toolsTrigger="cdkOverlayOrigin"
              cdkOverlayOrigin
              class="message-form__tools"
              [class.message-form__tools--open]="toolsMenuOpen()"
              appearance="subtle"
              icon="plus"
              type="button"
              [title]="t('chat.composer.tools.label')"
              [attr.aria-expanded]="toolsMenuOpen()"
              [attr.aria-pressed]="anyToolActive()"
              (click)="toggleToolsMenu()"
            >
              @if (!isMobile()) {
                {{ t('chat.composer.tools.label') }}
              }
            </cog-button>

            <ng-template
              cdkConnectedOverlay
              [cdkConnectedOverlayOrigin]="toolsTrigger"
              [cdkConnectedOverlayOpen]="toolsMenuOpen()"
              [cdkConnectedOverlayHasBackdrop]="true"
              cdkConnectedOverlayBackdropClass="cdk-overlay-transparent-backdrop"
              [cdkConnectedOverlayPositions]="modelSelectorPositions"
              [cdkConnectedOverlayPush]="true"
              (backdropClick)="closeToolsMenu()"
              (detach)="closeToolsMenu()"
              (overlayKeydown)="onOverlayKeydown($event)"
            >
              <app-composer-tools></app-composer-tools>
            </ng-template>

            @if (canAttach()) {
              <cog-icon-button
                #attachTrigger="cdkOverlayOrigin"
                cdkOverlayOrigin
                name="paperclip"
                class="message-form__attach"
                [title]="t('chat.composer.attachments.add')"
                [disabled]="!attachments.canAddMore()"
                type="button"
                data-testid="attach-button"
                [attr.aria-expanded]="attachMenuOpen()"
                (click)="attachMenuOpen.set(!attachMenuOpen())"
              />

              <ng-template
                cdkConnectedOverlay
                [cdkConnectedOverlayOrigin]="attachTrigger"
                [cdkConnectedOverlayOpen]="attachMenuOpen()"
                [cdkConnectedOverlayHasBackdrop]="true"
                cdkConnectedOverlayBackdropClass="cdk-overlay-transparent-backdrop"
                [cdkConnectedOverlayPositions]="modelSelectorPositions"
                [cdkConnectedOverlayPush]="true"
                (backdropClick)="attachMenuOpen.set(false)"
                (detach)="attachMenuOpen.set(false)"
              >
                <div class="message-form__attach-menu" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    class="message-form__attach-menu-item"
                    data-testid="attach-upload"
                    (click)="attachMenuOpen.set(false); openAttachmentPicker()"
                  >
                    <cog-icon name="upload" [size]="16" tone="text-subtle" />
                    {{ t('chat.composer.attachments.menu.upload') }}
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    class="message-form__attach-menu-item"
                    data-testid="attach-from-library"
                    (click)="attachMenuOpen.set(false); openLibraryPicker()"
                  >
                    <cog-icon name="folder" [size]="16" tone="text-subtle" />
                    {{ t('chat.composer.attachments.menu.fromLibrary') }}
                  </button>
                </div>
              </ng-template>
            }

            @if (canClearTemporaryMessages() && !isMobile()) {
              <cog-icon-button
                name="eraser"
                [title]="t('chat.composer.clearMessages')"
                type="button"
                (click)="onClearMessages()"
              />
            }

            @if (isStreaming()) {
              <cog-button
                class="message-form__send"
                appearance="primary"
                icon="x"
                [title]="t('chat.composer.stop')"
                type="button"
                (click)="stopStreaming()"
              >
                <span class="message-form__send-label">{{
                  t('chat.composer.stop')
                }}</span>
              </cog-button>
            } @else {
              <cog-button
                class="message-form__send"
                appearance="primary"
                icon="send"
                [title]="t('chat.composer.send')"
                type="submit"
                [disabled]="
                  messageForm.disabled || !messageForm.valid || !canSendMessage()
                "
              >
                <span class="message-form__send-label">{{
                  t('chat.composer.send')
                }}</span>
              </cog-button>
            }
          </div>
        </div>

        <div class="message-form__meta">
          <span class="message-form__security">
            <cog-icon name="lock" [size]="12" tone="text-subtlest" />
            <span>{{ t('chat.composer.encrypted') }}</span>
          </span>

          <span class="message-form__shortcut">
            @if (isMac) {
              {{ t('chat.composer.shortcutMac') }}
            } @else {
              {{ t('chat.composer.shortcutOther') }}
            }
          </span>
        </div>
      }
    </form>

    <app-library-picker
      [open]="libraryPickerOpen()"
      (attachSelected)="onLibraryAttach($event)"
      (closed)="libraryPickerOpen.set(false)"
    />

    <!-- Blocking confirm shown at send time when the draft still contains
         detected sensitive values the user opted out of redacting. It never
         appears when redaction is off, nothing is detected, or every detection
         is going to be redacted (the default), so it adds no routine friction. -->
    @if (redactionWarningOpen()) {
      <ng-container *transloco="let t">
        <div class="redaction-warning" role="presentation">
          <div
            class="redaction-warning__backdrop"
            (click)="cancelRedactionWarning()"
            aria-hidden="true"
          ></div>
          <div
            class="redaction-warning__panel"
            cdkTrapFocus
            [cdkTrapFocusAutoCapture]="true"
          >
            <cog-dialog-surface
              [title]="t('chat.composer.redactionWarning.title')"
              [closeLabel]="t('common.close')"
              icon="triangle-alert"
              iconTone="danger"
              [footer]="true"
              [width]="480"
              (close)="cancelRedactionWarning()"
            >
              <p class="redaction-warning__body">
                {{
                  t('chat.composer.redactionWarning.body', {
                    count: pendingUnredactedCount(),
                  })
                }}
              </p>

              <cog-dialog-actions cogDialogFooter>
                <cog-button appearance="subtle" (click)="cancelRedactionWarning()">
                  {{ t('chat.composer.redactionWarning.cancel') }}
                </cog-button>
                <cog-button appearance="default" (click)="sendAnyway()">
                  {{ t('chat.composer.redactionWarning.sendAnyway') }}
                </cog-button>
                <cog-button
                  appearance="primary"
                  icon="shield-check"
                  (click)="redactAndSend()"
                >
                  {{ t('chat.composer.redactionWarning.redactAndSend') }}
                </cog-button>
              </cog-dialog-actions>
            </cog-dialog-surface>
          </div>
        </div>
      </ng-container>
    }
  `,
  styles: `
    .message-form {
      display: grid;
      gap: var(--cog-space-100);
      width: 100%;
    }

    .message-form--drag-over .message-form__panel {
      outline: var(--cog-border-width-strong) dashed var(--cog-brand);
      outline-offset: var(--cog-border-width-strong);
    }

    .message-form__file-input {
      display: none;
    }

    .message-form__attachments {
      list-style: none;
      margin: 0;
      padding: 0;
      display: flex;
      flex-wrap: wrap;
      gap: var(--cog-space-100);
    }

    /* Attach (Upload / From library) dropdown — matches the Tools menu surface. */
    .message-form__attach-menu {
      display: grid;
      gap: var(--cog-space-050);
      width: min(220px, calc(100vw - var(--cog-space-200)));
      padding: var(--cog-space-050);
      border: var(--cog-border-width) solid var(--cog-border);
      border-radius: var(--cog-radius-md);
      background: var(--cog-surface);
      box-shadow: var(--cog-shadow-overlay);
    }

    .message-form__attach-menu-item {
      display: flex;
      align-items: center;
      gap: var(--cog-space-100);
      width: 100%;
      padding: var(--cog-space-100);
      font-size: var(--cog-fs-body);
      border: none;
      border-radius: var(--cog-radius-sm);
      background: transparent;
      color: var(--cog-text);
      text-align: left;
      cursor: pointer;
    }

    .message-form__attach-menu-item:hover {
      background: var(--cog-surface-hover);
    }

    .message-form__chip {
      display: inline-flex;
      align-items: center;
      gap: var(--cog-space-075);
      max-width: 16rem;
      padding: var(--cog-space-050) var(--cog-space-100);
      border: var(--cog-border-width) solid var(--cog-border);
      border-radius: var(--cog-radius-md);
      background: var(--cog-surface-sunken);
      font-size: 0.8125rem;
    }

    .message-form__chip--failed {
      border-color: var(--cog-danger);
    }

    .message-form__chip-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .message-form__chip-size,
    .message-form__chip-status {
      color: var(--cog-text-subtle);
      flex-shrink: 0;
    }

    .message-form__chip-truncated {
      display: inline-flex;
      align-items: center;
      gap: var(--cog-space-50);
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-caption);
      flex-shrink: 0;
      cursor: help;
    }

    .message-form__chip-remove {
      display: inline-flex;
      align-items: center;
      border: 0;
      background: transparent;
      cursor: pointer;
      padding: 0;
      color: var(--cog-text-subtle);
    }

    .message-form__chip-remove:hover {
      color: var(--cog-text);
    }

    .message-form__attachment-notice {
      margin: 0;
      font-size: var(--cog-fs-caption);
      color: var(--cog-text-subtle);
    }

    .message-form__model-switch {
      display: flex;
      align-items: flex-start;
      gap: var(--cog-space-075);
      padding: var(--cog-space-075) var(--cog-space-100);
      border: var(--cog-border-width) solid var(--cog-border);
      border-radius: var(--cog-radius-sm);
      background: var(--cog-surface-hover);
      font-size: var(--cog-fs-caption);
      color: var(--cog-text);
    }

    .message-form__model-switch-copy {
      flex: 1;
      line-height: var(--cog-lh-caption);
    }

    .message-form__model-switch-tier {
      display: block;
      color: var(--cog-text-subtle);
    }

    .message-form__model-switch-dismiss {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      padding: var(--cog-space-025);
      border: 0;
      background: transparent;
      color: var(--cog-text-subtle);
      cursor: pointer;
    }

    .message-form__model-switch-dismiss:hover {
      color: var(--cog-text);
    }

    /* Mobile model selector presented as a bottom sheet (spec §4.5). */
    .model-sheet-backdrop {
      position: fixed;
      inset: 0;
      background: var(--cog-scrim);
      z-index: 1000;
    }

    .model-sheet {
      position: fixed;
      inset: auto 0 0 0;
      z-index: 1001;
      display: flex;
      justify-content: center;
    }

    .message-form__panel {
      position: relative;
      display: grid;
      gap: var(--cog-space-150);
      border: var(--cog-border-width-strong) solid var(--cog-border);
      border-radius: var(--cog-radius-sm);
      background: var(--cog-surface);
      padding: var(--cog-space-150);
      transition: border-color var(--cog-dur-fast) var(--cog-ease-standard);
    }

    .message-form__panel:focus-within {
      border-color: var(--cog-brand);
    }

    .message-form__label {
      position: absolute;
      width: 1px;
      height: 1px;
      padding: 0;
      margin: -1px;
      overflow: hidden;
      clip: rect(0, 0, 0, 0);
      white-space: nowrap;
      border: 0;
    }

    .message-form__textarea {
      width: 100%;
      box-sizing: border-box;
      resize: none;
      border: 0;
      background: transparent;
      color: var(--cog-text);
      font: inherit;
      line-height: var(--cog-lh-body-lg);
      outline: 0;
      padding: 0;
      /* Wrapping + scrollbar gutter must match .message-form__highlights
         exactly, or the overlay marks drift once the textarea scrolls. */
      white-space: pre-wrap;
      overflow-wrap: break-word;
      word-break: normal;
      scrollbar-gutter: stable;
    }

    .message-form__textarea::placeholder {
      color: var(--cog-text-subtlest);
    }

    /* Highlight overlay: a backdrop mirroring the textarea exactly, with marks
       behind the (transparent-background) textarea text. Typography + box must
       match .message-form__textarea char-for-char so marks line up. */
    .message-form__editor {
      position: relative;
    }

    .message-form__highlights {
      position: absolute;
      inset: 0;
      box-sizing: border-box;
      margin: 0;
      padding: 0;
      overflow: hidden;
      pointer-events: none;
      white-space: pre-wrap;
      overflow-wrap: break-word;
      word-break: normal;
      /* Reserve the same gutter the textarea's scrollbar occupies so both
         layers wrap at the identical column. */
      scrollbar-gutter: stable;
      font: inherit;
      line-height: var(--cog-lh-body-lg);
      color: transparent;
    }

    .message-form__highlights ::ng-deep mark {
      background-color: var(--cog-loz-purple-bg);
      color: transparent;
      border-radius: var(--cog-radius-xs);
    }

    .message-form__editor--highlight .message-form__textarea {
      position: relative;
      z-index: 1;
      background: transparent;
    }

    .message-form__controls {
      display: flex;
      align-items: center;
      gap: var(--cog-space-100);
      flex-wrap: wrap;
    }

    /* The Tools button turns a slightly-transparent green while its dropdown is
       open, matching the model/persona triggers' open affordance. */
    .message-form__tools {
      transition:
        background var(--cog-dur-fast) var(--cog-ease-standard),
        color var(--cog-dur-fast) var(--cog-ease-standard);
    }

    .message-form__tools--open {
      background: color-mix(in srgb, var(--cog-brand) 14%, transparent);
      color: var(--cog-brand);
    }

    .message-form__reasoning-trigger {
      display: inline-flex;
      align-items: center;
      gap: var(--cog-space-050);
    }

    .message-form__reasoning-menu {
      min-width: 17rem;
      max-width: 22rem;
      padding: var(--cog-space-075);
      border: var(--cog-border-width) solid var(--cog-border);
      border-radius: var(--cog-radius-md);
      background: var(--cog-surface);
      box-shadow: var(--cog-shadow-overlay);
    }

    .message-form__reasoning-menu-heading {
      margin: 0;
      padding: var(--cog-space-050) var(--cog-space-075) var(--cog-space-075);
      color: var(--cog-text-subtlest);
      font-size: var(--cog-fs-caption);
      font-weight: var(--cog-fw-semibold);
      letter-spacing: 0.06em;
      text-transform: uppercase;
    }

    .message-form__reasoning-option {
      display: flex;
      align-items: flex-start;
      gap: var(--cog-space-100);
      width: 100%;
      border: 0;
      border-radius: var(--cog-radius-sm);
      background: none;
      padding: var(--cog-space-075);
      text-align: start;
      cursor: pointer;
      color: var(--cog-text);
    }

    .message-form__reasoning-option:hover {
      background: var(--cog-surface-hover);
    }

    .message-form__reasoning-option:focus-visible {
      outline: var(--cog-border-width-strong) solid var(--cog-brand);
      outline-offset: calc(var(--cog-border-width-strong) * -1);
    }

    .message-form__reasoning-option.is-selected {
      background: color-mix(in srgb, var(--cog-brand) 12%, transparent);
    }

    .message-form__reasoning-option-icon {
      margin-block-start: var(--cog-space-025);
      color: var(--cog-text-subtle);
      flex: none;
    }

    .message-form__reasoning-option.is-selected .message-form__reasoning-option-icon,
    .message-form__reasoning-option.is-selected .message-form__reasoning-option-label {
      color: var(--cog-brand);
    }

    .message-form__reasoning-option-text {
      display: grid;
      gap: var(--cog-space-025);
      flex: 1;
      min-width: 0;
    }

    .message-form__reasoning-option-label {
      font-size: var(--cog-fs-body-lg);
      line-height: 1.2;
    }

    .message-form__reasoning-option-desc {
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-body-sm);
    }

    .message-form__reasoning-option-check {
      margin-block-start: var(--cog-space-050);
      color: var(--cog-brand);
      flex: none;
    }

    .message-form__redaction {
      display: grid;
      gap: var(--cog-space-100);
    }

    .message-form__redaction-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--cog-space-100);
    }

    .message-form__redaction-summary {
      display: inline-flex;
      align-items: center;
      gap: var(--cog-space-075);
      align-self: start;
      border: 0;
      background: transparent;
      padding: 0;
      color: var(--cog-text-subtle);
      font: inherit;
      font-size: var(--cog-fs-caption);
      cursor: pointer;
    }

    .message-form__redaction-summary:hover {
      color: var(--cog-text);
    }

    .message-form__redaction-list {
      display: grid;
      gap: var(--cog-space-075);
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .message-form__redaction-item {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: var(--cog-space-100);
      flex-wrap: wrap;
    }

    .message-form__redaction-item--off {
      opacity: 0.55;
    }

    .message-form__redaction-toggle {
      display: inline-flex;
      align-items: center;
      gap: var(--cog-space-050);
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-caption);
      cursor: pointer;
      white-space: nowrap;
    }

    .message-form__redaction-remove {
      border: 0;
      background: transparent;
      padding: 0;
      color: var(--cog-text-subtle);
      font: inherit;
      font-size: var(--cog-fs-caption);
      text-decoration: underline;
      cursor: pointer;
      white-space: nowrap;
    }

    .message-form__redaction-remove:hover {
      color: var(--cog-text);
    }

    .message-form__redaction-remembered {
      color: var(--cog-text-subtlest);
      font-size: var(--cog-fs-caption);
      white-space: nowrap;
    }

    .message-form__redact-pop {
      position: fixed;
      z-index: 60;
      transform: translate(-50%, calc(-100% - 8px));
      display: inline-flex;
      align-items: center;
      gap: var(--cog-space-050);
      border: var(--cog-border-width) solid var(--cog-border);
      border-radius: var(--cog-radius-pill);
      background: var(--cog-surface);
      box-shadow: var(--cog-shadow-overlay);
      padding: var(--cog-space-050) 10px;
      color: var(--cog-text);
      font: inherit;
      font-size: var(--cog-fs-caption);
      font-weight: var(--cog-fw-semibold);
      cursor: pointer;
    }

    .message-form__redact-pop:hover {
      border-color: var(--cog-brand);
    }

    .message-form__send {
      margin-left: auto;
    }

    /* Mirrors the subtle model/tools buttons; native button to host the avatar. */
    .message-form__persona {
      display: inline-flex;
      box-sizing: border-box;
      align-items: center;
      gap: var(--cog-space-075);
      min-height: 32px;
      padding: 0 var(--cog-space-150);
      border: 0;
      border-radius: var(--cog-radius-xs);
      background: transparent;
      color: var(--cog-text-subtle);
      font: inherit;
      font-size: var(--cog-fs-label);
      font-weight: var(--cog-fw-label);
      line-height: var(--cog-lh-label);
      cursor: pointer;
      max-width: 220px;
    }

    .message-form__persona:hover {
      background: var(--cog-surface-hover);
    }

    .message-form__persona:focus-visible {
      outline: var(--cog-border-width-strong) solid var(--cog-brand);
      outline-offset: var(--cog-border-width-strong);
    }

    .message-form__persona-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: var(--cog-fw-semibold);
    }

    @media (max-width: 767px) {
      .message-form__persona {
        order: -1;
        flex-basis: 100%;
        inline-size: 100%;
        max-width: none;
        justify-content: space-between;
      }

      .message-form__model {
        flex: 1;
        min-width: 0;
      }
    }

    .message-form__locked-wrap {
      display: grid;
      gap: var(--cog-space-100);
    }

    .message-form__locked {
      display: flex;
      align-items: center;
      gap: var(--cog-space-150);
      flex-wrap: wrap;
      border: var(--cog-border-width) dashed var(--cog-border);
      border-radius: var(--cog-radius-md);
      background: var(--cog-surface-sunken);
      padding: var(--cog-space-150) var(--cog-space-200);
    }

    .message-form__locked-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 36px;
      height: 36px;
      flex: none;
      border-radius: var(--cog-radius-pill);
      background: var(--cog-surface);
      border: var(--cog-border-width) solid var(--cog-border);
    }

    .message-form__locked-copy {
      display: grid;
      gap: var(--cog-space-025);
      flex: 1;
      min-width: 0;
    }

    .message-form__locked-title {
      color: var(--cog-text);
      font-weight: var(--cog-fw-semibold);
      font-size: var(--cog-fs-body);
      line-height: var(--cog-lh-body);
    }

    .message-form__locked-body {
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-body-sm);
      line-height: var(--cog-lh-body-sm);
    }

    .message-form__locked-actions {
      display: flex;
      align-items: center;
      gap: var(--cog-space-100);
      flex: none;
    }

    .message-form__locked-note {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: var(--cog-space-050);
      margin: 0;
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-caption);
      line-height: var(--cog-lh-caption);
    }

    .message-form__meta,
    .message-form__security {
      display: flex;
      align-items: center;
      gap: var(--cog-space-100);
    }

    .message-form__meta {
      justify-content: space-between;
      flex-wrap: wrap;
    }

    .message-form__meta {
      color: var(--cog-text-subtlest);
      font-size: var(--cog-fs-caption);
      line-height: var(--cog-lh-caption);
    }

    .message-form__send-label {
      display: none;
    }

    @media (max-width: 767px) {
      .message-form__controls cog-button {
        min-width: 0;
      }

      .message-form__meta {
        display: none;
      }

      /* Give the locked notice's copy the full width and drop the actions onto
         their own row so the text isn't squeezed into a narrow column. */
      .message-form__locked {
        flex-wrap: wrap;
      }

      .message-form__locked-actions {
        flex-basis: 100%;
      }

      .message-form__locked-actions cog-button {
        flex: 1;
      }
    }

    /* Blocking sensitive-data confirm: a scrim + centred dialog surface,
       mirroring the mobile model sheet's backdrop pattern. */
    .redaction-warning {
      position: fixed;
      inset: 0;
      z-index: 1100;
      display: flex;
      align-items: center;
      justify-content: center;
      padding: var(--cog-space-200);
    }

    .redaction-warning__backdrop {
      position: absolute;
      inset: 0;
      background: var(--cog-scrim);
    }

    .redaction-warning__panel {
      position: relative;
      width: 100%;
      max-width: 480px;
    }

    .redaction-warning__body {
      margin: 0;
      color: var(--cog-text);
      font-size: var(--cog-fs-body);
      line-height: var(--cog-lh-body);
    }
  `,
})
export class MessageFormComponent {
  private readonly _fb = inject(FormBuilder);
  private readonly _platformId = inject(PLATFORM_ID);
  private readonly _conversationService = inject(ConversationService);
  private readonly _deviceService = inject(DeviceService);
  private readonly _router = inject(Router);
  private readonly _transloco = inject(TranslocoService);

  private _previousMessage = '';

  isMac = false;
  isMobile = computed(() => this._deviceService.isMobile());

  public readonly messageService = inject(MessageService);
  public readonly personaService = inject(PersonaService);
  public readonly modelService = inject(ModelService);
  public readonly billing = inject(BillingService);
  public readonly auth = inject(AuthService);
  private readonly _toast = inject(CognosToastService);

  // True while a "resend verification email" request is in flight.
  readonly emailResending = signal(false);
  // Composer tool state (image generation, …) — shared with the tools menu and
  // the model selector so toggling a tool drives send routing, model filtering
  // and the unsupported-model warning consistently.
  public readonly composerTools = inject(ComposerToolsService);

  // Attachments (spec docs/specs/attachments.md). The service owns the worker
  // and selection state; the composer renders chips and feeds files in.
  public readonly attachments = inject(AttachmentProcessingService);
  readonly attachmentAccept = ACCEPTED_ATTACHMENT_ACCEPT;
  private readonly _attachmentInput =
    viewChild<ElementRef<HTMLInputElement>>('attachmentInput');
  readonly attachmentDragOver = signal(false);
  // A transient, translated notice (e.g. the per-message cap was hit).
  readonly attachmentNotice = signal<string | null>(null);

  // Attachments need a persisted conversation (the upload endpoint is
  // conversation-scoped and the manifest is sealed to the conversation key). A
  // brand-new chat has no conversation yet, so attaching creates one first (like
  // sending the first message does). Only the ephemeral "temporary chat" mode —
  // which deliberately never persists — has no paperclip, mirroring image
  // generation.
  readonly canAttach = computed(
    () => !this._conversationService.isTemporaryConversation(),
  );

  readonly canSendMessage = computed(
    () =>
      this.modelService.selectedModel().isEligible &&
      !this.billing.isSendingLocked() &&
      !this.auth.needsEmailVerification() &&
      !this.composerTools.selectedModelUnsupported() &&
      !this.composerTools.selectedModelTextIncompatible() &&
      !this.attachments.hasPending(),
  );

  readonly attachMenuOpen = signal(false);

  openAttachmentPicker(): void {
    this.attachmentNotice.set(null);
    this._attachmentInput()?.nativeElement.click();
  }

  readonly libraryPickerOpen = signal(false);

  // Show the inline library picker (standard modal on desktop, sheet on mobile).
  openLibraryPicker(): void {
    this.attachmentNotice.set(null);
    this.libraryPickerOpen.set(true);
  }

  // On confirm: materialise each chosen file (decrypt its text context + redaction
  // mappings) and inject it as a ready selection.
  onLibraryAttach(chosen: LibraryFile[]): void {
    if (chosen.length === 0) {
      return;
    }
    forkJoin(chosen.map((file) => this._library.materialize(file))).subscribe({
      next: (selections) => {
        const accepted = this.attachments.addFromLibrary(selections);
        if (accepted < selections.length) {
          this.attachmentNotice.set(
            this._transloco.translate('chat.composer.attachments.tooMany', {
              max: this.attachments.count(),
            }),
          );
        }
      },
      error: () => {
        this.attachmentNotice.set(
          this._transloco.translate(
            'chat.composer.attachments.errors.processing_failed',
          ),
        );
      },
    });
  }

  onAttachmentInputChange(event: Event): void {
    const input = event.target as HTMLInputElement;
    this.acceptFiles(Array.from(input.files ?? []));
    input.value = ''; // allow re-selecting the same file
  }

  onAttachmentDragOver(event: DragEvent): void {
    if (!this.canAttach()) {
      return;
    }
    event.preventDefault();
    this.attachmentDragOver.set(true);
  }

  onAttachmentDragLeave(event: DragEvent): void {
    event.preventDefault();
    this.attachmentDragOver.set(false);
  }

  onAttachmentDrop(event: DragEvent): void {
    event.preventDefault();
    this.attachmentDragOver.set(false);
    if (!this.canAttach()) {
      return;
    }
    this.acceptFiles(Array.from(event.dataTransfer?.files ?? []));
  }

  onComposerPaste(event: ClipboardEvent): void {
    // Only intercept when the clipboard carries supported files (e.g. a pasted
    // screenshot). Plain/rich text paste is left to the browser untouched.
    const files = extractClipboardFiles(event.clipboardData);
    if (files.length === 0 || !this.canAttach()) {
      return;
    }
    event.preventDefault();
    this.acceptFiles(files);
  }

  removeAttachment(localId: string): void {
    this.attachments.remove(localId);
  }

  attachmentStateLabel(state: string): string {
    return this._transloco.translate(`chat.composer.attachments.state.${state}`);
  }

  attachmentErrorLabel(code: string | undefined): string {
    return this._transloco.translate(
      `chat.composer.attachments.errors.${code ?? 'processing_failed'}`,
    );
  }

  formatAttachmentSize(bytes: number): string {
    if (bytes < 1024) {
      return `${bytes} B`;
    }
    if (bytes < 1024 * 1024) {
      return `${(bytes / 1024).toFixed(1)} KB`;
    }
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  private acceptFiles(files: File[]): void {
    if (files.length === 0 || !this.canAttach()) {
      return;
    }

    // Images need a vision-capable model. Reject them with a clear notice when
    // the current model can't read images, rather than failing later on send.
    let rejectedImages = false;
    let candidates = files;
    if (!this.modelService.selectedModel().supportsVision) {
      const filtered = files.filter((file) => !isImageFile(file));
      rejectedImages = filtered.length < files.length;
      candidates = filtered;
    }

    if (candidates.length === 0) {
      if (rejectedImages) {
        this.attachmentNotice.set(
          this._transloco.translate('chat.composer.attachments.imageNeedsVision', {
            model: this.modelService.selectedModel().displayName,
          }),
        );
        this.armModelFilter('vision');
      }
      return;
    }

    // Files go to the user's library, sealed to their own key — no conversation
    // is needed to attach (one is created on send, as before). Guard the locked
    // vault: without the user key we cannot seal the manifest.
    const ownerPublicKey = this._vault.keyPair()?.publicKey;
    if (!ownerPublicKey) {
      this.attachmentNotice.set(
        this._transloco.translate('chat.composer.attachments.unavailable'),
      );
      return;
    }

    // Dedup: a file whose bytes are already in the library is reused (no second
    // upload), the rest are processed + uploaded as new library files.
    void this._library.splitNewVsExisting(candidates).then(({ toUpload, existing }) => {
      let accepted = 0;
      if (toUpload.length > 0) {
        accepted += this.attachments.add(
          toUpload,
          ownerPublicKey,
          // Send PDFs raw when the model accepts native files (better quality).
          this.modelService.selectedModel().supportsFileInput,
          // Redact detected sensitive values at processing time (opt-out via the
          // redaction toggle), so the provider never sees them.
          this._redactionService.enabled(),
        );
      }
      if (existing.length > 0) {
        forkJoin(existing.map((file) => this._library.materialize(file))).subscribe({
          next: (selections) => {
            accepted += this.attachments.addFromLibrary(selections);
            this.surfaceAcceptNotice(rejectedImages, accepted, candidates.length);
          },
          error: () =>
            this.surfaceAcceptNotice(rejectedImages, accepted, candidates.length),
        });
      } else {
        this.surfaceAcceptNotice(rejectedImages, accepted, candidates.length);
      }
    });
  }

  private surfaceAcceptNotice(
    rejectedImages: boolean,
    accepted: number,
    candidateCount: number,
  ): void {
    if (rejectedImages) {
      this.attachmentNotice.set(
        this._transloco.translate('chat.composer.attachments.imageNeedsVision', {
          model: this.modelService.selectedModel().displayName,
        }),
      );
      this.armModelFilter('vision');
    } else if (accepted < candidateCount) {
      this.attachmentNotice.set(
        this._transloco.translate('chat.composer.attachments.tooMany', {
          max: this.attachments.count(),
        }),
      );
    } else {
      // Everything was accepted — clear any stale notice (e.g. an earlier
      // "needs vision" warning left over before switching to a vision model).
      this.attachmentNotice.set(null);
    }
  }

  readonly toolsMenuOpen = signal(false);

  // Any tool active — used to highlight the "Tools" button.
  readonly anyToolActive = computed(() => this.composerTools.imageGenerationEnabled());

  toggleToolsMenu(): void {
    this.toolsMenuOpen.update((open) => !open);
  }

  closeToolsMenu(): void {
    this.toolsMenuOpen.set(false);
  }

  readonly isStreaming = computed(
    () => this.messageService.status() === MessageStatus.Sending,
  );

  messageForm = this._fb.group({
    content: new FormControl('', {
      nonNullable: true,
      validators: [Validators.required],
    }),
  });

  private readonly _redactionService = inject(RedactionService);
  private readonly _vault = inject(VaultService);
  private readonly _library = inject(AttachmentLibraryService);

  // Debounced draft drives the preview so detection never blocks typing
  // (spec §17). The textarea itself is never mutated.
  private readonly _redactionDraft = toSignal(
    this.messageForm.controls.content.valueChanges.pipe(debounceTime(150)),
    { initialValue: '' },
  );

  // Detected Tier 1 candidates for the current draft (empty when the user has
  // turned redaction off in settings).
  readonly redactionCandidates = computed(() =>
    this._redactionService.enabled()
      ? this._redactionService.detect(this._redactionDraft() ?? '')
      : [],
  );

  // Values manually redacted earlier in this conversation, so they're shown as
  // (auto-applied) redactions here too. Reactive to mappings loading via
  // revision(); the message service applies them on send.
  private readonly _rememberedCustomValues = computed(() => {
    if (!this._redactionService.enabled()) {
      return [];
    }
    this._redactionService.revision();
    const conversation = this._conversationService.conversation();
    return this._redactionService.customRedactionValues(
      conversation?.record.id ?? null,
    );
  });

  // Live (non-debounced) draft drives the highlight overlay so the marks stay
  // aligned with the textarea char-for-char while typing.
  private readonly _liveDraft = toSignal(
    this.messageForm.controls.content.valueChanges,
    { initialValue: '' },
  );

  // Eye toggle: paint the values that will be redacted directly in the composer.
  readonly highlightRedactions = signal(false);
  private readonly _highlights =
    viewChild<ElementRef<HTMLElement>>('redactionHighlights');

  // Escaped HTML with <mark> around each to-be-redacted range, rendered into an
  // overlay behind the (transparent-background) textarea. The textarea value is
  // never mutated — this is a display layer.
  readonly redactionHighlightHtml = computed(() => {
    if (!this.highlightRedactions() || !this._redactionService.enabled()) {
      return '';
    }
    const text = this._liveDraft() ?? '';
    const deselected = this._redactionDeselected();
    const auto = this._redactionService
      .detect(text)
      .filter((candidate) => !deselected.has(candidateKey(candidate)));
    const custom = buildCustomCandidates(text, [
      ...this._customRedactions(),
      ...this._rememberedCustomValues(),
    ]);
    const ranges = resolveOverlaps([...auto, ...custom]);

    let html = '';
    let cursor = 0;
    for (const range of ranges) {
      html +=
        escapeHtml(text.slice(cursor, range.start)) +
        '<mark>' +
        escapeHtml(text.slice(range.start, range.end)) +
        '</mark>';
      cursor = range.end;
    }
    return html + escapeHtml(text.slice(cursor));
  });

  // Value-keys (offset-independent) the user opted OUT of redacting.
  private readonly _redactionDeselected = signal<Set<string>>(new Set());
  readonly redactionPreviewOpen = signal(false);

  // Blocking send-time confirm: open state + how many un-redacted detected
  // values triggered it (shown in the dialog body).
  readonly redactionWarningOpen = signal(false);
  private readonly _pendingUnredacted = signal(0);
  readonly pendingUnredactedCount = this._pendingUnredacted.asReadonly();

  // Substrings the user manually selected to redact, and the floating "Redact"
  // action anchored to the pointer when there's a selection.
  private readonly _customRedactions = signal<string[]>([]);
  readonly redactPopover = signal<{ x: number; y: number; text: string } | null>(null);

  // Manual redactions for this message that are still present in the draft.
  readonly activeCustomRedactions = computed(() => {
    if (!this._redactionService.enabled()) {
      return [];
    }
    const draft = this._redactionDraft() ?? '';
    return this._customRedactions().filter((text) => draft.includes(text));
  });

  // Remembered (earlier-redacted) values present in the draft, minus any the
  // user is also selecting again right now.
  readonly rememberedCustomRedactions = computed(() => {
    const draft = this._redactionDraft() ?? '';
    const session = new Set(this._customRedactions());
    return this._rememberedCustomValues().filter(
      (value) => draft.includes(value) && !session.has(value),
    );
  });

  readonly hasRedactionPreview = computed(
    () =>
      this.redactionCandidates().length > 0 ||
      this.activeCustomRedactions().length > 0 ||
      this.rememberedCustomRedactions().length > 0,
  );

  // How many values (detected-and-selected + manual + remembered) get redacted.
  readonly redactionActiveCount = computed(
    () =>
      this.redactionCandidates().filter(
        (candidate) => !this._redactionDeselected().has(candidateKey(candidate)),
      ).length +
      this.activeCustomRedactions().length +
      this.rememberedCustomRedactions().length,
  );

  constructor() {
    if (isPlatformBrowser(this._platformId)) {
      this.isMac = window.navigator.userAgent.includes('Mac');
    }

    // Status-driven enable/disable + content restore. This must react only to
    // send status — the read-only check is read untracked so a billing refresh
    // can't re-fire this effect and clobber the composer's in-progress text via
    // the None branch.
    effect(() => {
      const status = this.messageService.status();

      if (untracked(() => this.billing.isSendingLocked())) {
        this.disableForm();
        return;
      }

      switch (status) {
        case MessageStatus.Sending:
          this.enableForm();
          break;
        case MessageStatus.Success:
          this._previousMessage = '';
          this.enableForm();
          // Reconcile the trial pill with the balance the completion just spent.
          this.billing.refresh();
          break;
        case MessageStatus.None:
        case MessageStatus.ErrorSending:
          // Only restore a prior draft (e.g. after a failed send). Never patch
          // an empty string over the composer — status settles to None during
          // conversation load and that would wipe text the user is typing.
          if (this._previousMessage) {
            this.messageForm.patchValue({ content: this._previousMessage });
          }
          this.enableForm();
          break;
      }
    });

    // An inactive plan is read-only: lock the composer whenever the plan flips
    // to inactive, and restore it (unless mid-send) if the plan becomes active
    // again. Kept separate so it never touches the composer's content.
    effect(() => {
      if (this.billing.isSendingLocked()) {
        this.disableForm();
      } else if (this.messageService.status() !== MessageStatus.Sending) {
        this.enableForm();
      }
    });

    // Lock background scroll while the mobile model sheet is open, so the page
    // behind it doesn't scroll under the user's thumb (spec §4.5). The sheet
    // itself traps focus via cdkTrapFocus and restores it to the trigger on
    // close. Desktop uses the CDK overlay, which manages this itself.
    effect((onCleanup) => {
      if (!isPlatformBrowser(this._platformId)) {
        return;
      }
      const locked = this.isMobile() && this.modelSelectorOpen();
      document.body.style.overflow = locked ? 'hidden' : '';
      // Always release the lock on teardown (component destroyed mid-open, e.g.
      // the footer link routes to Settings while the sheet is up) so the next
      // page isn't left unscrollable.
      onCleanup(() => {
        document.body.style.overflow = '';
      });
    });

    // The attachment notice is about the model in effect when it was shown (e.g.
    // "GPT-OSS can't read images"). Switching models makes it stale, so clear it
    // whenever the selected model changes — the user can re-attach if needed.
    effect(() => {
      this.modelService.selectedModel();
      untracked(() => this.attachmentNotice.set(null));
    });
  }

  readonly modelSelectorOpen = signal(false);
  readonly reasoningMenuOpen = signal(false);

  // One-shot model-filter suggestion. When the user attempts something the
  // current model can't do (e.g. paste an image without vision), we pre-select
  // the matching filter the *next* time the picker opens — but only if that's
  // soon (within the TTL) — then fall back to their remembered filter.
  private static readonly ARMED_FILTER_TTL_MS = 3 * 60 * 1000;
  private _armedFilter: QuickFilter | null = null;
  private _armedFilterExpiresAt = 0;
  // The filter handed to the selector for the current open (null = remembered).
  readonly modelFilterOverride = signal<QuickFilter | null>(null);

  readonly modelSelectorPositions = [
    {
      originX: 'start' as const,
      originY: 'top' as const,
      overlayX: 'start' as const,
      overlayY: 'bottom' as const,
      offsetY: -8,
    },
    {
      originX: 'start' as const,
      originY: 'bottom' as const,
      overlayX: 'start' as const,
      overlayY: 'top' as const,
      offsetY: 8,
    },
  ];

  readonly personaSwitcherOpen = signal(false);

  // The pinned-persona chips are a fresh-chat affordance: only shown before the
  // first message so they don't clutter an ongoing conversation.
  readonly showPersonaChips = computed(
    () => this.messageService.messages().length === 0,
  );

  togglePersonaSwitcher() {
    this.personaSwitcherOpen.update((open) => !open);
  }

  closePersonaSwitcher() {
    this.personaSwitcherOpen.set(false);
  }

  onPersonaOverlayKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      this.closePersonaSwitcher();
    }
  }

  goToBilling() {
    void this._router.navigate(['/pricing']);
  }

  // Resend the email-verification link to the signed-in address. On success a
  // toast confirms where to look; the composer unlocks by itself once the user
  // clicks the link and the refreshed auth record reports `verified`.
  resendVerification() {
    if (this.emailResending()) {
      return;
    }
    const email = this.auth.email();
    if (!email) {
      return;
    }
    this.emailResending.set(true);
    this.auth.requestVerification(email).subscribe({
      next: () => {
        this.emailResending.set(false);
        this._toast.notify({
          title: this._transloco.translate('chat.composer.verify.sent'),
          msg: this._transloco.translate('chat.composer.verify.sentBody', { email }),
          tone: 'success',
          icon: 'mail',
        });
      },
      error: () => this.emailResending.set(false),
    });
  }

  toggleModelSelector() {
    if (!this.modelSelectorOpen()) {
      // Opening: apply a live one-shot filter suggestion (if any), then consume
      // it so it never applies to a later open.
      const armed = this._armedFilter;
      this.modelFilterOverride.set(
        armed && Date.now() <= this._armedFilterExpiresAt ? armed : null,
      );
      this._armedFilter = null;
      this._armedFilterExpiresAt = 0;
    }
    this.modelSelectorOpen.update((open) => !open);
  }

  closeModelSelector() {
    this.modelSelectorOpen.set(false);
  }

  // Suggest a filter for the next picker open, if it happens soon. Used when the
  // user attempts something the current model can't do (e.g. attach an image to
  // a non-vision model) so the picker opens already narrowed to capable models.
  private armModelFilter(filter: QuickFilter): void {
    this._armedFilter = filter;
    this._armedFilterExpiresAt = Date.now() + MessageFormComponent.ARMED_FILTER_TTL_MS;
  }

  toggleReasoningMenu() {
    this.reasoningMenuOpen.update((open) => !open);
  }

  closeReasoningMenu() {
    this.reasoningMenuOpen.set(false);
  }

  // Human label for an effort tier. Falls back to a title-cased raw value so
  // model-specific tiers (e.g. "ultra") render sensibly without a translation.
  reasoningEffortLabel(effort: string): string {
    if (!effort) {
      return '';
    }
    const key = `chat.composer.reasoning.efforts.${effort}`;
    const label = this._transloco.translate(key);
    return label === key ? effort.charAt(0).toUpperCase() + effort.slice(1) : label;
  }

  // A signal-bars icon that fills more for higher effort. Model-specific tiers
  // we don't have a dedicated icon for fall back to the full bars. The literal
  // return type keeps it assignable to cog-icon's name input.
  reasoningEffortIcon(
    effort: string,
  ): 'signal-zero' | 'signal-low' | 'signal-medium' | 'signal-high' | 'signal' {
    switch (effort) {
      case 'off':
      case 'none':
        return 'signal-zero';
      case 'min':
      case 'minimal':
      case 'low':
        return 'signal-low';
      case 'medium':
        return 'signal-medium';
      case 'high':
        return 'signal-high';
      default:
        return 'signal';
    }
  }

  // One-line explanation of a tier, shown in the dropdown. Returns '' when the
  // tier has no translated description (e.g. model-specific tiers).
  reasoningEffortDescription(effort: string): string {
    if (!effort) {
      return '';
    }
    const key = `chat.composer.reasoning.descriptions.${effort}`;
    const description = this._transloco.translate(key);
    return description === key ? '' : description;
  }

  onReasoningEffortSelect(index: number) {
    const effort = this.modelService.selectedModel().reasoningEfforts[index];
    if (effort) {
      this.modelService.setReasoningEffort(effort);
    }
    this.closeReasoningMenu();
  }

  onOverlayKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      this.closeModelSelector();
      this.closeReasoningMenu();
    }
  }

  onSubmit() {
    if (this.isStreaming()) {
      this.stopStreaming();
      return;
    }

    this.sendMessage();
  }

  // Enter sends; Shift+Enter inserts a newline (handled by the textarea's
  // default, since Angular's `keydown.enter` only matches Enter with no
  // modifiers). On mobile the on-screen Return key must stay a newline —
  // sending there is the tap-target's job — so we leave the default alone.
  // Skip while an IME composition is active (e.g. selecting a CJK candidate
  // with Enter) so we never send a half-composed word.
  onEnterKey(event: Event) {
    if (this.isMobile() || (event as KeyboardEvent).isComposing) {
      return;
    }
    event.preventDefault();
    this.sendMessage();
  }

  sendMessage() {
    const content = this.messageForm.controls.content;
    const contentValue = content.value ?? '';

    if (content.invalid || this.messageForm.disabled || !this.canSendMessage()) {
      return;
    }

    // Guard the model-switched-after-attaching edge: image/raw-file attachments
    // only work on capable models. Block with a clear notice rather than letting
    // the backend reject the completion.
    const model = this.modelService.selectedModel();
    const selected = this.attachments.attachments();
    if (selected.some((a) => a.isImage) && !model.supportsVision) {
      this.attachmentNotice.set(
        this._transloco.translate('chat.composer.attachments.imageNeedsVision', {
          model: model.displayName,
        }),
      );
      return;
    }
    if (selected.some((a) => a.isRawFile) && !model.supportsFileInput) {
      this.attachmentNotice.set(
        this._transloco.translate('chat.composer.attachments.fileNeedsFileModel', {
          model: model.displayName,
        }),
      );
      return;
    }

    // Blocking guard: the draft still contains detected sensitive values the
    // user opted out of redacting. Confirm before they reach the provider in
    // the clear. Nothing detected (or everything being redacted) → no prompt.
    const unredacted = this.unredactedDetected(contentValue);
    if (unredacted.length > 0) {
      this._pendingUnredacted.set(unredacted.length);
      this.redactionWarningOpen.set(true);
      return;
    }

    this._dispatchSend(contentValue);
  }

  // Detected sensitive values still present in `content` that the user has
  // opted OUT of redacting — i.e. what would reach the provider un-redacted.
  // Empty when redaction is off or nothing has been deselected (the default),
  // so the send-time warning stays silent unless the user made that choice.
  private unredactedDetected(content: string): RedactionCandidate[] {
    if (!this._redactionService.enabled()) {
      return [];
    }
    const deselected = this._redactionDeselected();
    if (deselected.size === 0) {
      return [];
    }
    return this._redactionService
      .detect(content)
      .filter((candidate) => deselected.has(candidateKey(candidate)));
  }

  // The three confirm actions. "Redact & send" re-enables redaction for every
  // detected value (clearing the opt-outs) then sends; "Send anyway" sends the
  // draft as-is; cancel just closes the prompt and keeps the composer open.
  redactAndSend(): void {
    this._redactionDeselected.set(new Set());
    this.redactionWarningOpen.set(false);
    this._dispatchSend(this.messageForm.controls.content.value ?? '');
  }

  sendAnyway(): void {
    this.redactionWarningOpen.set(false);
    this._dispatchSend(this.messageForm.controls.content.value ?? '');
  }

  cancelRedactionWarning(): void {
    this.redactionWarningOpen.set(false);
  }

  private _dispatchSend(contentValue: string) {
    this._previousMessage = contentValue;
    const attachmentInputs = this.attachments.completionInputs();
    const messageRequest: MessageRequest = {
      content: contentValue,
      requestId: self.crypto.randomUUID(),
      redactionDeselected: Array.from(this._redactionDeselected()),
      redactionCustom: this._customRedactions(),
      imageGeneration: this.composerTools.imageGenerationEnabled(),
      attachmentIds: attachmentInputs.attachmentIds.length
        ? attachmentInputs.attachmentIds
        : undefined,
      attachmentContexts: attachmentInputs.attachmentContexts.length
        ? attachmentInputs.attachmentContexts
        : undefined,
      attachmentRedactionEntries: attachmentInputs.redactionEntries.length
        ? attachmentInputs.redactionEntries
        : undefined,
    };
    this.messageService.sendMessage$.next(messageRequest);
    this.attachments.clear();
    this.attachmentNotice.set(null);
    this.messageForm.reset();
    this._redactionDeselected.set(new Set());
    this._customRedactions.set([]);
    this.redactPopover.set(null);
    this.redactionPreviewOpen.set(false);
  }

  // --- manual (selection) redaction ----------------------------------------

  // Keep the highlight overlay scrolled in lockstep with the textarea.
  onComposerScroll(event: Event): void {
    const highlights = this._highlights()?.nativeElement;
    if (highlights) {
      highlights.scrollTop = (event.target as HTMLElement).scrollTop;
      highlights.scrollLeft = (event.target as HTMLElement).scrollLeft;
    }
  }

  onComposerMouseUp(event: MouseEvent): void {
    if (!this._redactionService.enabled()) {
      return;
    }
    const text = this.selectedText(event.target);
    this.redactPopover.set(text ? { x: event.clientX, y: event.clientY, text } : null);
  }

  onComposerContextMenu(event: MouseEvent): void {
    if (!this._redactionService.enabled()) {
      return;
    }
    const text = this.selectedText(event.target);
    if (!text) {
      return;
    }
    // Replace the native menu with our inline redact action.
    event.preventDefault();
    this.redactPopover.set({ x: event.clientX, y: event.clientY, text });
  }

  addCustomRedaction(text: string): void {
    this._customRedactions.update((list) =>
      list.includes(text) ? list : [...list, text],
    );
    this.redactPopover.set(null);
  }

  removeCustomRedaction(text: string): void {
    this._customRedactions.update((list) => list.filter((t) => t !== text));
  }

  // Dismiss the floating action when the pointer goes down anywhere that isn't
  // the action itself or the textarea (a fresh selection re-opens it).
  @HostListener('document:mousedown', ['$event'])
  onDocumentMouseDown(event: MouseEvent): void {
    const target = event.target as HTMLElement | null;
    if (target?.closest('.message-form__redact-pop, .message-form__textarea')) {
      return;
    }
    this.redactPopover.set(null);
  }

  private selectedText(target: EventTarget | null): string {
    const textarea = target as HTMLTextAreaElement | null;
    if (!textarea || textarea.selectionStart == null) {
      return '';
    }
    return (textarea.value ?? '')
      .slice(textarea.selectionStart, textarea.selectionEnd)
      .trim();
  }

  toggleRedactionPreview(): void {
    this.redactionPreviewOpen.update((open) => !open);
  }

  redactionKeyOf(candidate: RedactionCandidate): string {
    return candidateKey(candidate);
  }

  isRedacted(candidate: RedactionCandidate): boolean {
    return !this._redactionDeselected().has(candidateKey(candidate));
  }

  toggleRedaction(candidate: RedactionCandidate): void {
    const key = candidateKey(candidate);
    this._redactionDeselected.update((set) => {
      const next = new Set(set);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  }

  // Map a detector type to the redacted-text pill's visual kind; everything
  // without a dedicated icon falls back to a labelled "custom" pill.
  redactionKind(candidate: RedactionCandidate): CognosRedactedTextKind {
    return redactionKindFor(candidate.type);
  }

  // Localised explainer-modal copy for the preview pills, so the public/library
  // component shows the same translated strings as the rest of the app.
  modalLabels(): CognosRedactedTextLabels {
    return redactionModalLabels(this._transloco);
  }

  // Illustrative placeholder shown in the preview (the real random token is
  // minted at send time).
  redactionPlaceholder(candidate: RedactionCandidate): string {
    return `[[PII_${tokenTypeCode(candidate.type)}]]`;
  }

  stopStreaming() {
    this.messageService.stopActiveCompletion();
  }

  onComposerEscape(event: Event) {
    if (!this.isStreaming()) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    this.stopStreaming();
  }

  disableForm() {
    this.messageForm.disable();
  }

  enableForm() {
    this.messageForm.enable();
  }

  canClearTemporaryMessages = computed(() => {
    return (
      this._conversationService.isTemporaryConversation() &&
      this.messageService.messages().length > 0
    );
  });

  onClearMessages() {
    this.messageService.resetState();
  }
}
