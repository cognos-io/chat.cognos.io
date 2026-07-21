import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  computed,
  inject,
  input,
  signal,
} from '@angular/core';

import { TranslocoModule, TranslocoService } from '@jsverse/transloco';

import {
  CognosButtonComponent,
  CognosCalloutComponent,
  CognosIconComponent,
  CognosRedactedTextComponent,
} from '@cognos/ui-angular';

import { RedactedMarkdownComponent } from '@app/components/chat/redacted-markdown/redacted-markdown.component';
import {
  redactionKindFor,
  redactionModalLabels,
  redactionTypeLabel,
} from '@app/components/chat/redaction-ui';
import { CogDocBlock } from '@app/documents/cog-doc/cog-doc.types';
import { DocumentExportService } from '@app/documents/document-export.service';
import { Message } from '@app/interfaces/message';
import { splitRedactionSegments } from '@app/redaction';
import { ConversationService } from '@app/services/conversation.service';
import { RedactionService } from '@app/services/redaction.service';

/**
 * DocumentCardComponent shows a model-authored `<cog-doc>` block (see
 * docs/business_processes/document-generation.md) inline in an assistant message: a
 * title/format header, a state area ("Creating document…" while streaming, a
 * Download button once ready), and a collapsed-by-default preview of the raw
 * body through the same markdown renderer used for the rest of the message.
 *
 * `state: 'invalid'` is never passed in — the caller (message-list-item) fails
 * that case open to plain markdown at the segment level instead of rendering
 * this card (spec), so this component only ever needs to distinguish
 * 'streaming' from 'ready'.
 *
 * xlsx bodies are sheet-spec JSON, not prose (spec), so a spreadsheet
 * card offers no preview at all: the header is static (no expand caret) and
 * only the Download action is shown. Dumping raw sheet JSON into the card was
 * more noise than help — the document is a render, not text to read inline.
 * docx/pdf keep the collapsed-by-default markdown preview.
 */
@Component({
  selector: 'app-document-card',
  standalone: true,
  imports: [
    NgTemplateOutlet,
    CognosButtonComponent,
    CognosCalloutComponent,
    CognosIconComponent,
    CognosRedactedTextComponent,
    RedactedMarkdownComponent,
    TranslocoModule,
  ],
  template: `
    <div class="document-card" *transloco="let t">
      <ng-template #headerBody>
        <cog-icon name="file-text" [size]="18" tone="text-subtle" />
        <span class="document-card__title">
          @for (segment of titleSegments(); track $index) {
            @if (segment.pill; as pill) {
              <!-- A redaction placeholder in the title (e.g. a name the model
                   never saw): hydrate it to the real value as a pill so the
                   user sees their own words, highlighted to show it stayed
                   private. -->
              <cog-redacted-text
                [value]="pill.value"
                [placeholder]="pill.placeholder"
                [kind]="pill.kind"
                [label]="pill.label"
                [labels]="pillLabels()"
                [showSettings]="false"
                [masked]="valuesHidden()"
              />
            } @else {
              {{ segment.text }}
            }
          }
        </span>
        <span class="document-card__format">{{ formatLabel() }}</span>
      </ng-template>

      @if (canPreview()) {
        <button
          type="button"
          class="document-card__header"
          [attr.aria-expanded]="expanded()"
          (click)="toggleExpanded()"
        >
          <ng-container [ngTemplateOutlet]="headerBody" />
          <cog-icon
            class="document-card__caret"
            [name]="expanded() ? 'chevron-down' : 'chevron-right'"
            [size]="14"
            tone="text-subtlest"
          />
        </button>
      } @else {
        <div class="document-card__header document-card__header--static">
          <ng-container [ngTemplateOutlet]="headerBody" />
        </div>
      }

      <div class="document-card__status">
        @switch (block().state) {
          @case ('streaming') {
            <p class="document-card__creating" role="status" aria-live="polite">
              <cog-icon name="loader" [size]="14" class="document-card__spinner" />
              {{ t('chat.message.documentCreating') }}
            </p>
          }
          @case ('ready') {
            <cog-button
              appearance="default"
              [disabled]="downloading()"
              (click)="download()"
            >
              {{
                downloadFailed()
                  ? t('chat.message.documentRenderFailed')
                  : t('chat.message.download')
              }}
            </cog-button>
            @if (canSaveToLibrary()) {
              <cog-button
                appearance="subtle"
                icon="folder"
                [disabled]="saving()"
                (click)="saveToLibrary()"
              >
                {{
                  saveFailed()
                    ? t('chat.message.documentSaveFailed')
                    : saved()
                      ? t('chat.message.documentSavedToLibrary')
                      : t('chat.message.documentSaveToLibrary')
                }}
              </cog-button>
            }
          }
        }
      </div>

      @if (showFormulaWarning()) {
        <cog-callout tone="warning" icon="triangle-alert">
          {{ t('chat.message.documentFormulaWarning') }}
        </cog-callout>
      }

      @if (canPreview() && expanded()) {
        <div class="document-card__preview" role="region">
          <app-redacted-markdown [content]="block().body" />
        </div>
      }
    </div>
  `,
  styles: `
    :host {
      display: block;
    }

    .document-card {
      display: grid;
      gap: var(--cog-space-100);
      border: var(--cog-border-width) solid var(--cog-border);
      border-radius: var(--cog-radius-md);
      background: var(--cog-surface);
      padding: var(--cog-space-100) var(--cog-space-150);
    }

    .document-card__header {
      display: flex;
      align-items: center;
      gap: var(--cog-space-075);
      border: 0;
      background: transparent;
      margin: 0;
      padding: 0;
      color: inherit;
      font: inherit;
      text-align: left;
      cursor: pointer;
    }

    .document-card__header--static {
      cursor: default;
    }

    .document-card__header:focus-visible {
      outline: var(--cog-border-width-strong) solid var(--cog-brand);
      outline-offset: var(--cog-border-width-strong);
      border-radius: var(--cog-radius-xs);
    }

    .document-card__title {
      overflow: hidden;
      color: var(--cog-text);
      font-size: var(--cog-fs-body);
      font-weight: var(--cog-fw-semibold);
      line-height: var(--cog-lh-body);
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .document-card__format {
      flex: none;
      border-radius: var(--cog-radius-xs);
      background: var(--cog-surface-hover);
      padding: 1px var(--cog-space-050);
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-caption);
      font-weight: var(--cog-fw-semibold);
      letter-spacing: 0.02em;
    }

    .document-card__caret {
      flex: none;
      margin-inline-start: auto;
    }

    .document-card__status {
      display: flex;
      align-items: center;
      gap: var(--cog-space-075);
    }

    .document-card__creating {
      display: inline-flex;
      align-items: center;
      gap: var(--cog-space-075);
      margin: 0;
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-body-sm);
    }

    .document-card__spinner {
      display: inline-flex;
      animation: document-card-spin 0.9s linear infinite;
    }

    @keyframes document-card-spin {
      to {
        transform: rotate(360deg);
      }
    }

    @media (prefers-reduced-motion: reduce) {
      .document-card__spinner {
        animation: none;
      }
    }

    .document-card__preview {
      border-block-start: var(--cog-border-width) solid var(--cog-border);
      padding-block-start: var(--cog-space-100);
      color: var(--cog-text-subtle);
      font-size: var(--cog-fs-body-sm);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DocumentCardComponent {
  private readonly _documentExport = inject(DocumentExportService);
  private readonly _transloco = inject(TranslocoService);
  private readonly _redaction = inject(RedactionService);
  private readonly _conversation = inject(ConversationService);

  readonly block = input.required<CogDocBlock>();
  readonly message = input.required<Message>();

  protected readonly expanded = signal(false);
  protected readonly downloading = signal(false);
  protected readonly downloadFailed = signal(false);
  protected readonly showFormulaWarning = signal(false);
  // Save-to-library has its own in-flight/feedback state, independent of
  // Download's — the two actions can be triggered independently and must
  // not fight over the same button label (spec).
  protected readonly saving = signal(false);
  protected readonly saved = signal(false);
  protected readonly saveFailed = signal(false);
  private _downloadFailedTimer?: ReturnType<typeof setTimeout>;
  private _saveFeedbackTimer?: ReturnType<typeof setTimeout>;

  protected readonly isXlsx = computed(() => this.block().spec?.format === 'xlsx');

  // The attachment registry deliberately accepts no spreadsheets (pinned in
  // processor-registry.spec.ts), so an xlsx library save always fails closed —
  // hide the action rather than offer a guaranteed failure. Revisit if a
  // permissively-licensed sheet processor lands (spec).
  protected readonly canSaveToLibrary = computed(() => !this.isXlsx());

  // xlsx bodies are sheet-spec JSON, not prose — there's nothing worth reading
  // inline, so a spreadsheet card is download-only: no expand caret, no
  // preview. docx/pdf keep the collapsed markdown preview.
  protected readonly canPreview = computed(() => !this.isXlsx());

  protected readonly title = computed(() => {
    const spec = this.block().spec;
    return (
      spec?.title?.trim() ||
      spec?.filename?.trim() ||
      this._transloco.translate('chat.message.documentDefaultName')
    );
  });

  protected readonly formatLabel = computed(
    () => this.block().spec?.format.toUpperCase() ?? '',
  );

  // Whether redacted values are globally masked (••••••). Bound straight to the
  // pill so toggling it live-updates the title, matching the message body.
  protected readonly valuesHidden = this._redaction.valuesHidden;

  // Same explainer-modal copy for every pill; recomputed only via the template.
  protected readonly pillLabels = computed(() => redactionModalLabels(this._transloco));

  // The title split into plain-text runs and hydrated redaction pills. Model-
  // authored titles carry the same placeholder tokens as the message (a name,
  // an email…), so we resolve each to its real value against the conversation's
  // scoped redaction map and hand the template ready-made pill inputs. Reads
  // revision() so tokens that were raw before the map loaded become pills once
  // it arrives; unknown tokens stay as plain placeholder text.
  protected readonly titleSegments = computed(() => {
    this._redaction.revision();
    const conversation = this._conversation.conversation();
    const entries = this._redaction.combinedEntriesFor(
      conversation?.record.id,
      conversation?.record.project,
    );
    return splitRedactionSegments(this.title(), [...entries.values()]).map((segment) =>
      segment.entry
        ? {
            text: segment.text,
            pill: {
              value: segment.entry.original,
              placeholder: segment.entry.token,
              kind: redactionKindFor(segment.entry.type),
              label: redactionTypeLabel(this._transloco, segment.entry.type),
            },
          }
        : { text: segment.text, pill: undefined },
    );
  });

  constructor() {
    inject(DestroyRef).onDestroy(() => {
      clearTimeout(this._downloadFailedTimer);
      clearTimeout(this._saveFeedbackTimer);
    });
  }

  protected toggleExpanded(): void {
    this.expanded.update((value) => !value);
  }

  protected download(): void {
    if (this.downloading()) {
      return;
    }
    this.downloading.set(true);
    this.showFormulaWarning.set(false);
    this._documentExport
      .downloadCogDoc(this.block(), this.message())
      .then((warnings) => this.showFormulaWarning.set(!!warnings?.length))
      .catch(() => this.onDownloadFailed())
      .finally(() => this.downloading.set(false));
  }

  private onDownloadFailed(): void {
    this.downloadFailed.set(true);
    clearTimeout(this._downloadFailedTimer);
    this._downloadFailedTimer = setTimeout(() => {
      this.downloadFailed.set(false);
    }, 2000);
  }

  protected saveToLibrary(): void {
    if (this.saving()) {
      return;
    }
    this.saving.set(true);
    this.saved.set(false);
    this.saveFailed.set(false);
    this._documentExport
      .saveCogDocToLibrary(this.block(), this.message())
      .then(() => this.onSaveFeedback(this.saved))
      .catch(() => this.onSaveFeedback(this.saveFailed))
      .finally(() => this.saving.set(false));
  }

  private onSaveFeedback(flag: typeof this.saved): void {
    flag.set(true);
    clearTimeout(this._saveFeedbackTimer);
    this._saveFeedbackTimer = setTimeout(() => {
      flag.set(false);
    }, 2000);
  }
}
