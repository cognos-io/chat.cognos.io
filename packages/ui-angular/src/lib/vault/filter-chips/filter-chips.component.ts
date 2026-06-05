import {
  ChangeDetectionStrategy,
  Component,
  input,
  output,
} from "@angular/core";

import type { CognosVaultFilter } from "../vault.types";

const FILTER_OPTIONS: Array<{ value: CognosVaultFilter; label: string }> = [
  { value: "all", label: "All" },
  { value: "doc", label: "Documents" },
  { value: "image", label: "Images" },
  { value: "sheet", label: "Sheets" },
  { value: "audio", label: "Audio" },
];

@Component({
  selector: "cog-filter-chips",
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="cog-filter-chips">
      @for (option of options; track option.value) {
        <button class="cog-filter-chips__chip" [class.cog-filter-chips__chip--selected]="option.value === value()" type="button" (click)="change.emit(option.value)">
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
        gap: 7px;
      }

      .cog-filter-chips__chip {
        min-height: 30px;
        border: 1px solid var(--cog-border);
        border-radius: var(--cog-radius-pill);
        background: var(--cog-surface);
        padding: 0 12px;
        color: var(--cog-text-subtle);
        font-size: 13px;
        line-height: 1.4;
        cursor: pointer;

        &:focus-visible {
          outline: 2px solid var(--cog-brand);
          outline-offset: 2px;
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
  readonly value = input<CognosVaultFilter>("all");
  readonly change = output<CognosVaultFilter>();
  protected readonly options = FILTER_OPTIONS;
}
