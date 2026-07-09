import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

import type { CognosVaultFilter } from '../vault.types';

export type CognosFilterChipOption = {
  value: CognosVaultFilter;
  label: string;
};

/** English defaults — host apps pass translated `options` for i18n. */
export const DEFAULT_FILTER_OPTIONS: CognosFilterChipOption[] = [
  { value: 'all', label: 'All' },
  { value: 'doc', label: 'Documents' },
  { value: 'image', label: 'Images' },
  { value: 'sheet', label: 'Sheets' },
  { value: 'audio', label: 'Audio' },
];

@Component({
  selector: 'cog-filter-chips',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="cog-filter-chips" role="group" [attr.aria-label]="groupLabel() || null">
      @for (option of options(); track option.value) {
        <button
          class="cog-filter-chips__chip"
          [class.cog-filter-chips__chip--selected]="option.value === value()"
          [attr.aria-pressed]="option.value === value()"
          type="button"
          (click)="change.emit(option.value)"
        >
          {{ option.label }}
        </button>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .cog-filter-chips {
        display: flex;
        flex-wrap: wrap;
        gap: var(--cog-space-075);
      }

      .cog-filter-chips__chip {
        min-height: 30px;
        border: var(--cog-border-width) solid var(--cog-border);
        border-radius: var(--cog-radius-pill);
        background: var(--cog-surface);
        padding: 0 var(--cog-space-150);
        color: var(--cog-text-subtle);
        font-size: var(--cog-fs-body-sm);
        line-height: 1.4;
        cursor: pointer;

        &:focus-visible {
          outline: var(--cog-border-width-strong) solid var(--cog-brand);
          outline-offset: var(--cog-border-width-strong);
        }
      }

      .cog-filter-chips__chip--selected {
        border-color: var(--cog-selected-border);
        background: var(--cog-selected-bg);
        color: var(--cog-selected-text);
        font-weight: var(--cog-fw-semibold);
      }
    `,
  ],
})
export class CognosFilterChipsComponent {
  readonly value = input<CognosVaultFilter>('all');
  readonly groupLabel = input('');
  /** Filter options + labels. Defaults to English; pass translated labels for i18n. */
  readonly options = input<CognosFilterChipOption[]>(DEFAULT_FILTER_OPTIONS);
  readonly change = output<CognosVaultFilter>();
}
