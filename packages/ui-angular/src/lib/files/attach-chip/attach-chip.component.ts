import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from '@angular/core';

import { CognosIconComponent } from '../../icon/icon.component';
import { CognosFileBadgeComponent } from '../file-badge/file-badge.component';
import { deriveFileExtension } from '../file-types';

export type CognosAttachChipState = 'sealed' | 'encrypting';

@Component({
  selector: 'cog-attach-chip',
  standalone: true,
  imports: [CognosFileBadgeComponent, CognosIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="cog-attach-chip">
      <cog-file-badge [ext]="resolvedExt()" [size]="22" [radius]="3" />
      <span class="cog-attach-chip__name">{{ name() }}</span>

      @if (state() === 'encrypting') {
        <cog-icon name="loader" [size]="12" tone="text-subtlest" />
      } @else {
        <cog-icon name="lock" [size]="11" tone="success" />
      }

      @if (removeable()) {
        <button
          class="cog-attach-chip__remove"
          type="button"
          aria-label="Remove attachment"
          title="Remove attachment"
          (click)="remove.emit()"
        >
          <cog-icon name="x" [size]="13" tone="text-subtlest" />
        </button>
      }
    </span>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
        max-width: 100%;
      }

      .cog-attach-chip {
        display: inline-flex;
        max-width: 220px;
        align-items: center;
        gap: var(--cog-space-100);
        overflow: hidden;
        border: var(--cog-border-width) solid var(--cog-border);
        border-radius: var(--cog-radius-sm);
        background: var(--cog-surface);
        padding: 0 var(--cog-space-075);
        min-height: 34px;
      }

      .cog-attach-chip__name {
        min-width: 0;
        overflow: hidden;
        color: var(--cog-text);
        font-size: var(--cog-fs-caption);
        line-height: 1.4;
        text-overflow: ellipsis;
        white-space: nowrap;
      }

      .cog-attach-chip__remove {
        display: inline-flex;
        width: 20px;
        height: 20px;
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
          outline: var(--cog-border-width-strong) solid var(--cog-brand);
          outline-offset: var(--cog-border-width-strong);
        }
      }
    `,
  ],
})
export class CognosAttachChipComponent {
  readonly name = input('');
  readonly ext = input<string | null>(null);
  readonly state = input<CognosAttachChipState>('sealed');
  readonly removeable = input(false);
  readonly remove = output<void>();

  protected readonly resolvedExt = computed(
    () => this.ext() || deriveFileExtension(this.name()),
  );
}
