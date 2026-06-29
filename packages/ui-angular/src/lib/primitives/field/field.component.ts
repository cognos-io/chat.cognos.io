import { ChangeDetectionStrategy, Component, input } from '@angular/core';

/**
 * CognosFieldComponent (`cog-field`) is the labelled form-field wrapper: a label
 * above a projected control, with optional hint or error text below and
 * consistent spacing. It owns layout/typography only — the control (usually
 * `cog-text-field`, or any input) keeps its own value/forms binding.
 *
 *   <cog-field [label]="'Email'" [error]="emailError()">
 *     <cog-text-field formControlName="email" type="email" size="lg" />
 *   </cog-field>
 *
 * `error` takes precedence over `hint` when both are set.
 */
@Component({
  selector: 'cog-field',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="cog-field">
      @if (label()) {
        <span class="cog-field__label">{{ label() }}</span>
      }
      <ng-content />
      @if (error()) {
        <p class="cog-field__error" role="alert">{{ error() }}</p>
      } @else if (hint()) {
        <p class="cog-field__hint">{{ hint() }}</p>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .cog-field {
        display: grid;
        gap: var(--cog-space-100);
      }

      .cog-field__label {
        color: var(--cog-text);
        font-size: var(--cog-fs-body-sm);
        font-weight: var(--cog-fw-semibold);
        line-height: var(--cog-lh-body-sm);
      }

      .cog-field__hint {
        margin: 0;
        color: var(--cog-text-subtle);
        font-size: var(--cog-fs-body-sm);
        line-height: var(--cog-lh-body-sm);
        text-wrap: pretty;
      }

      .cog-field__error {
        margin: 0;
        color: var(--cog-danger-text);
        font-size: var(--cog-fs-body-sm);
        line-height: var(--cog-lh-body-sm);
      }
    `,
  ],
})
export class CognosFieldComponent {
  readonly label = input('');
  readonly hint = input('');
  readonly error = input('');
}
