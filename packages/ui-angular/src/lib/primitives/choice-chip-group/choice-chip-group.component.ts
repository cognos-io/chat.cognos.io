import {
  ChangeDetectionStrategy,
  Component,
  booleanAttribute,
  input,
  output,
} from '@angular/core';

export interface CognosChoiceChip {
  value: string;
  label: string;
}

/**
 * CognosChoiceChipGroupComponent (`cog-choice-chip-group`) is a horizontal,
 * wrapping group of single-select pill chips — model filters, billing interval,
 * view toggles, etc. Selecting a chip emits its value via `valueChange`; set
 * `allowDeselect` so clicking the active chip clears the selection (emits null).
 *
 *   <cog-choice-chip-group [options]="opts" [value]="active()" allowDeselect
 *                          (valueChange)="active.set($event)" />
 *
 * Labels must be passed already-translated. Project extra controls (e.g. a reset
 * button) as default content; they render inline after the chips.
 */
@Component({
  selector: 'cog-choice-chip-group',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="cog-chip-group" role="group" [attr.aria-label]="ariaLabel() || null">
      @for (chip of options(); track chip.value) {
        <button
          type="button"
          class="cog-chip"
          [class.cog-chip--active]="chip.value === value()"
          [attr.aria-pressed]="chip.value === value()"
          (click)="select(chip.value)"
        >
          {{ chip.label }}
        </button>
      }
      <ng-content />
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .cog-chip-group {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: var(--cog-space-075);
      }

      .cog-chip {
        display: inline-flex;
        align-items: center;
        min-height: 32px;
        padding: 0 var(--cog-space-100);
        border: 1px solid var(--cog-border);
        border-radius: var(--cog-radius-pill);
        background: var(--cog-surface);
        color: var(--cog-text-subtle);
        font: inherit;
        font-size: var(--cog-fs-caption);
        cursor: pointer;
        transition:
          background-color var(--cog-dur-fast) var(--cog-ease-standard),
          border-color var(--cog-dur-fast) var(--cog-ease-standard);
      }

      .cog-chip--active {
        border-color: var(--cog-brand);
        background: var(--cog-loz-green-bg);
        color: var(--cog-brand);
        font-weight: var(--cog-fw-semibold);
      }
    `,
  ],
})
export class CognosChoiceChipGroupComponent {
  readonly options = input<CognosChoiceChip[]>([]);
  readonly value = input<string | null>(null);
  readonly ariaLabel = input('');
  readonly allowDeselect = input(false, { transform: booleanAttribute });

  readonly valueChange = output<string | null>();

  protected select(value: string): void {
    if (this.allowDeselect() && this.value() === value) {
      this.valueChange.emit(null);
    } else {
      this.valueChange.emit(value);
    }
  }
}
