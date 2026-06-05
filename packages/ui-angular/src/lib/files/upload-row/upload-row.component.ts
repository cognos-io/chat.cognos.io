import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from "@angular/core";

import { CognosIconComponent } from "../../icon/icon.component";
import { CognosFileBadgeComponent } from "../file-badge/file-badge.component";
import { CognosProgressComponent } from "../progress/progress.component";
import { deriveFileExtension } from "../file-types";

@Component({
  selector: "cog-upload-row",
  standalone: true,
  imports: [
    CognosFileBadgeComponent,
    CognosIconComponent,
    CognosProgressComponent,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="cog-upload-row">
      <cog-file-badge [ext]="resolvedExt()" [size]="34" [radius]="4" />

      <div class="cog-upload-row__copy">
        <div class="cog-upload-row__header">
          <span class="cog-upload-row__name">{{ name() }}</span>
          <span class="cog-upload-row__status">{{ done() ? "Sealed" : roundedProgress() + "%" }}</span>
        </div>

        <div class="cog-upload-row__progress">
          <cog-progress [value]="progress()" [tone]="done() ? 'var(--cog-success)' : 'var(--cog-brand)'" />
        </div>

        <div class="cog-upload-row__meta">
          @if (done()) {
            <cog-icon name="lock" [size]="11" tone="success" />
            <span>Encrypted on this device</span>
          } @else {
            <cog-icon name="loader" [size]="11" tone="text-subtlest" />
            <span>Sealing…</span>
          }
        </div>
      </div>

      @if (!done() && cancellable()) {
        <button class="cog-upload-row__cancel" type="button" aria-label="Cancel upload" title="Cancel upload" (click)="cancel.emit()">
          <cog-icon name="x" [size]="15" tone="text-subtlest" />
        </button>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .cog-upload-row {
        display: flex;
        align-items: center;
        gap: 12px;
        border: 1px solid var(--cog-border);
        border-radius: var(--cog-radius-sm);
        background: var(--cog-surface);
        padding: 10px 12px;
      }

      .cog-upload-row__copy {
        min-width: 0;
        flex: 1;
      }

      .cog-upload-row__header {
        display: flex;
        align-items: center;
        gap: 8px;
      }

      .cog-upload-row__name {
        min-width: 0;
        flex: 1;
        overflow: hidden;
        color: var(--cog-text);
        font-size: 13px;
        font-weight: var(--cog-fw-medium);
        line-height: 1.4;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .cog-upload-row__status {
        color: var(--cog-text-subtlest);
        font-family: var(--cog-font-mono);
        font-size: 11px;
        line-height: 1.4;
      }

      .cog-upload-row__progress {
        margin-top: 6px;
      }

      .cog-upload-row__meta {
        display: inline-flex;
        align-items: center;
        gap: 5px;
        margin-top: 5px;
        color: var(--cog-text-subtlest);
        font-size: 11px;
        line-height: 1.4;
      }

      .cog-upload-row__cancel {
        display: inline-flex;
        width: 26px;
        height: 26px;
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
export class CognosUploadRowComponent {
  readonly name = input("");
  readonly ext = input<string | null>(null);
  readonly progress = input(0);
  readonly done = input(false);
  readonly cancellable = input(false);
  readonly cancel = output<void>();

  protected readonly resolvedExt = computed(
    () => this.ext() || deriveFileExtension(this.name()),
  );
  protected readonly roundedProgress = computed(() => Math.round(this.progress()));
}
