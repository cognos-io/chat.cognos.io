import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';

import { CognosIconComponent } from '../../icon/icon.component';
import { CognosFileBadgeComponent } from '../file-badge/file-badge.component';
import { deriveFileExtension, resolveFileType } from '../file-types';
import { CognosProgressComponent } from '../progress/progress.component';

export type CognosDocAttachmentState = 'sealed' | 'encrypting' | 'error';

@Component({
  selector: 'cog-doc-attachment',
  standalone: true,
  imports: [CognosFileBadgeComponent, CognosIconComponent, CognosProgressComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <article
      class="cog-doc-attachment"
      [class]="attachmentClass()"
      [attr.role]="interactive() ? 'button' : null"
      [attr.tabindex]="interactive() ? 0 : null"
      [style.width]="widthStyle()"
      (click)="onCardClick()"
      (keydown.enter)="onCardClick()"
      (keydown.space)="$event.preventDefault(); onCardClick()"
    >
      <cog-file-badge [ext]="resolvedExt()" [size]="38" [radius]="4" />

      <div class="cog-doc-attachment__copy">
        <div class="cog-doc-attachment__name">{{ name() }}</div>

        @switch (state()) {
          @case ('encrypting') {
            <div class="cog-doc-attachment__progress-wrap">
              <cog-progress [value]="progress()" [height]="4" />
              <div class="cog-doc-attachment__meta cog-doc-attachment__meta--subtle">
                <cog-icon name="loader" [size]="11" tone="text-subtlest" />
                <span>Encrypting on this device · {{ roundedProgress() }}%</span>
              </div>
            </div>
          }
          @case ('error') {
            <div class="cog-doc-attachment__meta cog-doc-attachment__meta--danger">
              <cog-icon name="triangle-alert" [size]="12" tone="danger" />
              <span>Couldn't encrypt — tap to retry</span>
            </div>
          }
          @default {
            <div class="cog-doc-attachment__meta-row">
              <span class="cog-doc-attachment__meta cog-doc-attachment__meta--subtle">{{
                resolvedMeta()
              }}</span>
              @if (showEncrypted()) {
                <span
                  class="cog-doc-attachment__meta cog-doc-attachment__meta--success"
                >
                  <cog-icon name="lock" [size]="11" tone="success" />
                  <span>Encrypted</span>
                </span>
              }
            </div>
          }
        }
      </div>

      <ng-content select="[cogDocAttachmentTrailing]" />

      @if (showRemove()) {
        <button
          class="cog-doc-attachment__remove"
          type="button"
          aria-label="Remove attachment"
          title="Remove attachment"
          (click)="$event.stopPropagation(); remove.emit()"
        >
          <cog-icon name="x" [size]="14" tone="text-subtlest" />
        </button>
      }
    </article>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .cog-doc-attachment {
        display: flex;
        width: min(100%, 280px);
        max-width: 100%;
        align-items: center;
        gap: 11px;
        box-sizing: border-box;
        overflow: hidden;
        border: 1px solid var(--cog-border);
        border-radius: var(--cog-radius-sm);
        background: var(--cog-surface);
        padding: 10px 11px;
        transition:
          border-color var(--cog-dur-fast) var(--cog-ease-standard),
          box-shadow var(--cog-dur-fast) var(--cog-ease-standard);

        &.cog-doc-attachment--interactive {
          cursor: pointer;
        }

        &.cog-doc-attachment--interactive:hover {
          border-color: var(--cog-border-bold);
        }

        &.cog-doc-attachment--interactive:focus-visible {
          outline: 2px solid var(--cog-brand);
          outline-offset: 2px;
        }

        &.cog-doc-attachment--error {
          border-color: var(--cog-danger);
        }
      }

      .cog-doc-attachment__copy {
        min-width: 0;
        flex: 1;
      }

      .cog-doc-attachment__name {
        overflow: hidden;
        color: var(--cog-text);
        font-size: 14px;
        font-weight: var(--cog-fw-medium);
        line-height: var(--cog-lh-body);
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .cog-doc-attachment__progress-wrap {
        margin-top: var(--cog-space-075);
      }

      .cog-doc-attachment__meta-row {
        display: flex;
        flex-wrap: wrap;
        gap: var(--cog-space-075);
        margin-top: var(--cog-space-025);
      }

      .cog-doc-attachment__meta {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        min-width: 0;
        font-size: 11.5px;
        line-height: 1.4;
      }

      .cog-doc-attachment__meta--subtle {
        margin-top: 5px;
        color: var(--cog-text-subtlest);
      }

      .cog-doc-attachment__meta--danger {
        margin-top: var(--cog-space-025);
        color: var(--cog-danger);
      }

      .cog-doc-attachment__meta--success {
        color: var(--cog-success-text);
      }

      .cog-doc-attachment__remove {
        display: inline-flex;
        width: 24px;
        height: 24px;
        flex: none;
        align-items: center;
        justify-content: center;
        border: 0;
        border-radius: var(--cog-radius-xs);
        background: transparent;
        cursor: pointer;

        &:hover {
          background: var(--cog-surface-hover);
        }

        &:focus-visible {
          outline: 2px solid var(--cog-brand);
          outline-offset: 2px;
        }
      }
    `,
  ],
})
export class CognosDocAttachmentComponent {
  readonly name = input('document.pdf');
  readonly ext = input<string | null>(null);
  readonly size = input('320 KB');
  readonly meta = input<string | null>(null);
  readonly state = input<CognosDocAttachmentState>('sealed');
  readonly progress = input(0);
  readonly width = input<number | string>(280);
  readonly clickable = input(false);
  readonly removeable = input(false);
  /**
   * Whether to show the "Encrypted" lock indicator in the sealed state. Defaults
   * to true; hosts can hide it where encryption is already signalled nearby (e.g.
   * an attachment inside a message bubble that already shows an encrypted badge).
   */
  readonly showEncrypted = input(true);
  readonly open = output<void>();
  readonly retry = output<void>();
  readonly remove = output<void>();

  protected readonly resolvedExt = computed(
    () => this.ext() || deriveFileExtension(this.name()),
  );
  protected readonly resolvedMeta = computed(
    () =>
      this.meta() || `${resolveFileType(this.resolvedExt()).label} · ${this.size()}`,
  );
  protected readonly roundedProgress = computed(() => Math.round(this.progress()));
  protected readonly widthStyle = computed(() =>
    typeof this.width() === 'number' ? `${this.width()}px` : this.width(),
  );
  protected readonly interactive = computed(
    () => this.clickable() || this.state() === 'error',
  );
  protected readonly showRemove = computed(
    () => this.removeable() && this.state() !== 'encrypting',
  );
  protected readonly attachmentClass = computed(() => {
    const classes = ['cog-doc-attachment'];

    if (this.interactive()) {
      classes.push('cog-doc-attachment--interactive');
    }

    if (this.state() === 'error') {
      classes.push('cog-doc-attachment--error');
    }

    return classes.join(' ');
  });

  protected onCardClick(): void {
    if (this.state() === 'error') {
      this.retry.emit();
      return;
    }

    if (this.clickable()) {
      this.open.emit();
    }
  }
}
