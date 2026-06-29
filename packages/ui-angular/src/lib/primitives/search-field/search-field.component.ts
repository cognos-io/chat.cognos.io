import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

import { CognosIconComponent } from '../../icon/icon.component';

/**
 * CognosSearchFieldComponent (`cog-search-field`) is the standard search input:
 * a leading magnifier icon, a 44px full-width accessible field, and a
 * `valueChange` output. Use it for the library, model, persona, etc. filters so
 * they share one look instead of hand-rolled inputs with differing borders.
 *
 *   <cog-search-field [placeholder]="t('library.searchPlaceholder')"
 *                     (valueChange)="query.set($event)" />
 */
@Component({
  selector: 'cog-search-field',
  standalone: true,
  imports: [CognosIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label class="cog-search-field">
      <cog-icon
        class="cog-search-field__icon"
        name="search"
        [size]="16"
        tone="text-subtlest"
      />
      <input
        class="cog-search-field__control"
        type="search"
        [placeholder]="placeholder()"
        [value]="value()"
        [attr.aria-label]="ariaLabel() || placeholder() || null"
        (input)="onInput($event)"
      />
    </label>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .cog-search-field {
        display: flex;
        min-height: 44px;
        align-items: center;
        gap: var(--cog-space-100);
        border: 1px solid var(--cog-border);
        border-radius: var(--cog-radius-md);
        background: var(--cog-surface);
        padding: 0 var(--cog-space-150);
        transition:
          background-color var(--cog-dur-fast) var(--cog-ease-standard),
          border-color var(--cog-dur-fast) var(--cog-ease-standard);
      }

      .cog-search-field:focus-within {
        border-color: var(--cog-brand);
      }

      .cog-search-field__icon {
        display: inline-flex;
        flex: none;
        align-items: center;
        justify-content: center;
      }

      .cog-search-field__control {
        width: 100%;
        border: 0;
        background: transparent;
        color: var(--cog-text);
        font: inherit;
        font-size: var(--cog-fs-body);
        outline: 0;
      }
    `,
  ],
})
export class CognosSearchFieldComponent {
  readonly placeholder = input('');
  readonly value = input('');
  readonly ariaLabel = input('');

  readonly valueChange = output<string>();

  protected onInput(event: Event): void {
    this.valueChange.emit((event.target as HTMLInputElement).value);
  }
}
