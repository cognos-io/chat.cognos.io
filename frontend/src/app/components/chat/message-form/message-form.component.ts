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

import { debounceTime } from 'rxjs';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';

import {
  CognosButtonComponent,
  CognosIconButtonComponent,
  CognosIconComponent,
  CognosRedactedTextComponent,
  type CognosRedactedTextKind,
  type CognosRedactedTextLabels,
} from '@cognos/ui-angular';

import { PersonaAvatarComponent } from '@app/components/personas/persona-avatar/persona-avatar.component';
import {
  RedactionCandidate,
  buildCustomCandidates,
  candidateKey,
  resolveOverlaps,
  tokenTypeCode,
} from '@app/redaction';
import { BillingService } from '@app/services/billing.service';
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

import { redactionKindFor, redactionModalLabels } from '../redaction-ui';
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
    OverlayModule,
    CognosButtonComponent,
    CognosIconButtonComponent,
    CognosIconComponent,
    CognosRedactedTextComponent,
    ModelSelectorComponent,
    PersonaSwitcherComponent,
    PersonaChipsComponent,
    PersonaAvatarComponent,
    TranslocoModule,
  ],
  template: `
    <form
      class="message-form"
      [formGroup]="messageForm"
      (submit)="onSubmit()"
      (keydown.escape)="onComposerEscape($event)"
      *transloco="let t"
    >
      @if (billing.isSendingLocked()) {
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
              (keydown.control.enter)="isMac ? undefined : sendMessage()"
              (keydown.meta.enter)="isMac ? sendMessage() : undefined"
              (mouseup)="onComposerMouseUp($event)"
              (contextmenu)="onComposerContextMenu($event)"
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
              appearance="default"
              iconAfter="chevron-down"
              type="button"
              (click)="toggleModelSelector()"
            >
              {{ modelService.selectedModel().name }}
            </cog-button>

            <ng-template
              cdkConnectedOverlay
              [cdkConnectedOverlayOrigin]="modelTrigger"
              [cdkConnectedOverlayOpen]="modelSelectorOpen()"
              [cdkConnectedOverlayHasBackdrop]="true"
              cdkConnectedOverlayBackdropClass="cdk-overlay-transparent-backdrop"
              [cdkConnectedOverlayPositions]="modelSelectorPositions"
              (backdropClick)="closeModelSelector()"
              (detach)="closeModelSelector()"
              (overlayKeydown)="onOverlayKeydown($event)"
            >
              <app-model-selector
                (modelSelected)="closeModelSelector()"
              ></app-model-selector>
            </ng-template>

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
                [size]="22"
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
              (backdropClick)="closePersonaSwitcher()"
              (detach)="closePersonaSwitcher()"
              (overlayKeydown)="onPersonaOverlayKeydown($event)"
            >
              <app-persona-switcher
                (personaSelected)="closePersonaSwitcher()"
                (managed)="closePersonaSwitcher()"
              ></app-persona-switcher>
            </ng-template>

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
  `,
  styles: `
    .message-form {
      display: grid;
      gap: var(--cog-space-100);
      width: 100%;
    }

    .message-form__panel {
      position: relative;
      display: grid;
      gap: var(--cog-space-150);
      border: 2px solid var(--cog-border);
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
      font-size: 16px;
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
      font-size: 16px;
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
      border: 1px solid var(--cog-border);
      border-radius: var(--cog-radius-pill);
      background: var(--cog-surface);
      box-shadow: var(--cog-shadow-overlay);
      padding: 4px 10px;
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

    .message-form__persona {
      display: inline-flex;
      align-items: center;
      gap: var(--cog-space-075, 6px);
      padding: 4px 8px 4px 4px;
      border: 1px solid var(--cog-border);
      border-radius: var(--cog-radius-pill, 999px);
      background: var(--cog-surface);
      color: var(--cog-text);
      font: inherit;
      font-size: var(--cog-fs-caption, 13px);
      cursor: pointer;
      max-width: 200px;
      transition: border-color var(--cog-dur-fast) var(--cog-ease-standard);
    }

    .message-form__persona:hover {
      border-color: var(--cog-border-strong, var(--cog-brand));
    }

    .message-form__persona-name {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: var(--cog-fw-semibold, 600);
    }

    @media (max-width: 767px) {
      /* The persona switcher spans the full width above the model/send row. */
      .message-form__persona {
        order: -1;
        flex-basis: 100%;
        inline-size: 100%;
        max-width: none;
        justify-content: space-between;
      }

      /* Model selector and send share the line below; the model takes the
         remaining space and the send button stays pinned to the right. */
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
      border: 1px dashed var(--cog-border);
      border-radius: var(--cog-radius-md);
      background: var(--cog-surface-sunken, var(--cog-surface));
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
      border: 1px solid var(--cog-border);
    }

    .message-form__locked-copy {
      display: grid;
      gap: 2px;
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

  readonly canSendMessage = computed(
    () =>
      this.modelService.selectedModel().isEligible && !this.billing.isSendingLocked(),
  );

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
  }

  readonly modelSelectorOpen = signal(false);

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

  toggleModelSelector() {
    this.modelSelectorOpen.update((open) => !open);
  }

  closeModelSelector() {
    this.modelSelectorOpen.set(false);
  }

  onOverlayKeydown(event: KeyboardEvent) {
    if (event.key === 'Escape') {
      this.closeModelSelector();
    }
  }

  onSubmit() {
    if (this.isStreaming()) {
      this.stopStreaming();
      return;
    }

    this.sendMessage();
  }

  sendMessage() {
    const content = this.messageForm.controls.content;
    const contentValue = content.value ?? '';

    if (content.invalid || this.messageForm.disabled || !this.canSendMessage()) {
      return;
    }

    this._previousMessage = contentValue;
    const messageRequest: MessageRequest = {
      content: contentValue,
      requestId: self.crypto.randomUUID(),
      redactionDeselected: Array.from(this._redactionDeselected()),
      redactionCustom: this._customRedactions(),
    };
    this.messageService.sendMessage$.next(messageRequest);
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
