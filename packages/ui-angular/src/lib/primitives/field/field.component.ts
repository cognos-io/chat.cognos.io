import {
  ChangeDetectionStrategy,
  Component,
  InjectionToken,
  Signal,
  computed,
  input,
} from '@angular/core';

let nextFieldId = 0;

export type CognosFieldA11yContext = {
  controlId: Signal<string>;
  describedById: Signal<string | null>;
};

export const COG_FIELD_A11Y = new InjectionToken<CognosFieldA11yContext>(
  'COG_FIELD_A11Y',
);

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
  providers: [{ provide: COG_FIELD_A11Y, useExisting: CognosFieldComponent }],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="cog-field">
      @if (label()) {
        <label class="cog-field__label" [attr.for]="controlId()">{{ label() }}</label>
      }
      <ng-content />
      @if (error()) {
        <p class="cog-field__error" role="alert" [id]="errorId()">{{ error() }}</p>
      } @else if (hint()) {
        <p class="cog-field__hint" [id]="hintId()">{{ hint() }}</p>
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
  private readonly generatedId = `cog-field-${++nextFieldId}`;

  readonly label = input('');
  readonly inputId = input('');
  readonly hint = input('');
  readonly error = input('');

  protected readonly controlId = computed(() => this.inputId() || this.generatedId);
  protected readonly hintId = computed(() => `${this.controlId()}-hint`);
  protected readonly errorId = computed(() => `${this.controlId()}-error`);

  readonly describedById = computed(() => {
    if (this.error()) {
      return this.errorId();
    }

    if (this.hint()) {
      return this.hintId();
    }

    return null;
  });
}
