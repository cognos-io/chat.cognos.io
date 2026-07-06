import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

import type { CognosIconName } from '@cognos/ui/icons';

import { CognosIconComponent } from '../../icon/icon.component';

export interface CognosSegmentedOption {
  value: string;
  label: string;
  // Optional trailing icon (e.g. a direction chevron on a sort segment). Shown
  // after the label.
  icon?: CognosIconName;
  // Rotate the trailing icon 180° — e.g. to flip a chevron between ascending
  // and descending on a bidirectional segment.
  iconRotated?: boolean;
  // Accessible label for the trailing icon (e.g. "Cost, low to high"), announced
  // to assistive tech so the icon's meaning isn't visual-only.
  iconLabel?: string;
}

/**
 * CognosSegmentedControlComponent (`cog-segmented-control`) is a connected,
 * single-select track of buttons — a "pick one" ordering/view switcher (sort
 * modes, chart ranges, list layouts). Unlike `cog-choice-chip-group` (loose
 * filter pills), the segments share one sunken track so it reads as a single
 * control.
 *
 *   <cog-segmented-control [options]="opts" [value]="active()"
 *                          (select)="active.set($event)" />
 *
 * `select` fires on EVERY click — including re-clicking the already-active
 * segment — so callers can implement bidirectional toggles (e.g. a Cost segment
 * that flips low↔high on repeated taps). Labels must be passed
 * already-translated. Give an `icon` on an option for a trailing indicator, and
 * `iconRotated` to flip it.
 */
@Component({
  selector: 'cog-segmented-control',
  standalone: true,
  imports: [CognosIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="cog-segmented" role="group" [attr.aria-label]="ariaLabel() || null">
      @for (option of options(); track option.value) {
        <button
          type="button"
          class="cog-segmented__option"
          [class.cog-segmented__option--active]="option.value === value()"
          [attr.aria-pressed]="option.value === value()"
          (click)="select.emit(option.value)"
        >
          {{ option.label }}
          @if (option.icon) {
            <cog-icon
              class="cog-segmented__icon"
              [class.cog-segmented__icon--rotated]="option.iconRotated"
              [name]="option.icon"
              [title]="option.iconLabel || ''"
              [size]="12"
              tone="current"
            />
          }
        </button>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .cog-segmented {
        display: flex;
        gap: 2px;
        padding: 2px;
        border-radius: var(--cog-radius-sm);
        background: var(--cog-surface-sunken);
      }

      .cog-segmented__option {
        flex: 1 1 0;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        gap: var(--cog-space-025);
        min-height: 30px;
        padding: 0 var(--cog-space-075);
        border: 0;
        border-radius: var(--cog-radius-xs);
        background: transparent;
        color: var(--cog-text-subtle);
        font: inherit;
        font-size: var(--cog-fs-caption);
        cursor: pointer;
        white-space: nowrap;
        transition:
          background-color var(--cog-dur-fast) var(--cog-ease-standard),
          color var(--cog-dur-fast) var(--cog-ease-standard);
      }

      .cog-segmented__option:hover {
        color: var(--cog-text);
      }

      .cog-segmented__option:focus-visible {
        outline: var(--cog-border-width-strong) solid var(--cog-brand);
        outline-offset: var(--cog-border-width-strong);
      }

      .cog-segmented__option--active {
        background: var(--cog-surface-raised);
        color: var(--cog-text);
        font-weight: var(--cog-fw-semibold);
        box-shadow: var(--cog-shadow-raised);
      }

      .cog-segmented__icon {
        transition: transform var(--cog-dur-fast) var(--cog-ease-standard);
      }

      .cog-segmented__icon--rotated {
        transform: rotate(180deg);
      }
    `,
  ],
})
export class CognosSegmentedControlComponent {
  readonly options = input<CognosSegmentedOption[]>([]);
  readonly value = input<string | null>(null);
  readonly ariaLabel = input('');

  // Emits the clicked option's value on every click, including re-clicks of the
  // active segment (enables bidirectional toggles).
  readonly select = output<string>();
}
