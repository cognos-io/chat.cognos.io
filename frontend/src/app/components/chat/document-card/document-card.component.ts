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

import { CognosButtonComponent, CognosIconComponent } from '@cognos/ui-angular';

import { RedactedMarkdownComponent } from '@app/components/chat/redacted-markdown/redacted-markdown.component';
import { CogDocBlock } from '@app/documents/cog-doc/cog-doc.types';
import { DocumentExportService } from '@app/documents/document-export.service';
import { Message } from '@app/interfaces/message';

/**
 * DocumentCardComponent shows a model-authored `<cog-doc>` block (spec
 * docs/specs/document-generation.md §5.2) inline in an assistant message: a
 * title/format header, a state area ("Creating document…" while streaming, a
 * Download button once ready), and a collapsed-by-default preview of the raw
 * body through the same markdown renderer used for the rest of the message.
 *
 * `state: 'invalid'` is never passed in — the caller (message-list-item) fails
 * that case open to plain markdown at the segment level instead of rendering
 * this card (spec §3.5), so this component only ever needs to distinguish
 * 'streaming' from 'ready'.
 */
@Component({
  selector: 'app-document-card',
  standalone: true,
  imports: [
    CognosButtonComponent,
    CognosIconComponent,
    RedactedMarkdownComponent,
    TranslocoModule,
  ],
  template: `
    <div class="document-card" *transloco="let t">
      <button
        type="button"
        class="document-card__header"
        [attr.aria-expanded]="expanded()"
        (click)="toggleExpanded()"
      >
        <cog-icon name="file-text" [size]="18" tone="text-subtle" />
        <span class="document-card__title">{{ title() }}</span>
        <span class="document-card__format">{{ formatLabel() }}</span>
        <cog-icon
          class="document-card__caret"
          [name]="expanded() ? 'chevron-down' : 'chevron-right'"
          [size]="14"
          tone="text-subtlest"
        />
      </button>

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
          }
        }
      </div>

      @if (expanded()) {
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
      border: 1px solid var(--cog-border);
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

    .document-card__header:focus-visible {
      outline: 2px solid var(--cog-brand);
      outline-offset: 2px;
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
      border-block-start: 1px solid var(--cog-border);
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

  readonly block = input.required<CogDocBlock>();
  readonly message = input.required<Message>();

  protected readonly expanded = signal(false);
  protected readonly downloading = signal(false);
  protected readonly downloadFailed = signal(false);
  private _downloadFailedTimer?: ReturnType<typeof setTimeout>;

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

  constructor() {
    inject(DestroyRef).onDestroy(() => clearTimeout(this._downloadFailedTimer));
  }

  protected toggleExpanded(): void {
    this.expanded.update((value) => !value);
  }

  protected download(): void {
    if (this.downloading()) {
      return;
    }
    this.downloading.set(true);
    this._documentExport
      .downloadCogDoc(this.block(), this.message())
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
}
