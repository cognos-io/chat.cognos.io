import {
  ChangeDetectionStrategy,
  Component,
  computed,
  forwardRef,
  input,
  model,
  signal,
} from '@angular/core';
import { ControlValueAccessor, NG_VALUE_ACCESSOR } from '@angular/forms';

import type { CognosIconName } from '@cognos/ui/icons';

import { CognosIconComponent } from '../../icon/icon.component';

export type CognosTextFieldSize = 'md' | 'lg';

/**
 * CognosTextFieldComponent (`cog-text-field`) is the styled single-line input.
 * It works two ways:
 *   - uncontrolled/value binding: `[value]` + `(valueChange)`
 *   - reactive/template forms: `formControlName` / `[(ngModel)]` (it is a
 *     ControlValueAccessor)
 *
 * `size="lg"` (44px, radius-sm) matches the auth/onboarding field look; the
 * default `md` (36px) suits dense settings forms. Pair with `cog-field` for a
 * label + hint/error.
 */
@Component({
  selector: 'cog-text-field',
  standalone: true,
  imports: [CognosIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => CognosTextFieldComponent),
      multi: true,
    },
  ],
  template: `
    <label [class]="fieldClass()">
      @if (icon()) {
        <span class="cog-text-field__icon">
          <cog-icon [name]="icon()!" [size]="14" tone="text-subtlest" />
        </span>
      }

      <input
        class="cog-text-field__control"
        [disabled]="effectiveDisabled()"
        [placeholder]="placeholder()"
        [readOnly]="readonly()"
        [type]="type()"
        [value]="value()"
        [attr.autocomplete]="autocomplete() || null"
        [attr.inputmode]="inputmode() || null"
        [attr.aria-label]="ariaLabel() || placeholder() || null"
        (input)="onInput($event)"
        (blur)="onTouched()"
      />
    </label>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .cog-text-field {
        display: flex;
        min-height: 36px;
        align-items: center;
        gap: var(--cog-space-100);
        border: var(--cog-border-width-strong) solid var(--cog-border);
        border-radius: var(--cog-radius-xs);
        background: var(--cog-input-bg);
        padding: 0 var(--cog-space-150);
        transition:
          background-color var(--cog-dur-fast) var(--cog-ease-standard),
          border-color var(--cog-dur-fast) var(--cog-ease-standard);

        &:focus-within {
          border-color: var(--cog-brand);
          background: var(--cog-input-bg-focus);
        }

        &.cog-text-field--lg {
          min-height: 44px;
          border-radius: var(--cog-radius-sm);
        }

        &.cog-text-field--disabled {
          opacity: 0.5;
          pointer-events: none;
        }
      }

      .cog-text-field__icon {
        display: inline-flex;
        flex: none;
        align-items: center;
        justify-content: center;
      }

      .cog-text-field__control {
        width: 100%;
        border: 0;
        background: transparent;
        color: var(--cog-text);
        font: inherit;
        font-size: var(--cog-fs-body);
        line-height: var(--cog-lh-body);
        outline: 0;

        &::placeholder {
          color: var(--cog-text-subtlest);
        }
      }

      @media (max-width: 767px) {
        .cog-text-field {
          min-height: 44px;
        }
      }
    `,
  ],
})
export class CognosTextFieldComponent implements ControlValueAccessor {
  readonly icon = input<CognosIconName | null>(null);
  readonly value = model('');
  readonly placeholder = input('');
  readonly type = input('text');
  readonly autocomplete = input('');
  readonly inputmode = input<string | null>(null);
  readonly ariaLabel = input('');
  readonly disabled = input(false);
  readonly readonly = input(false);
  readonly size = input<CognosTextFieldSize>('md');

  // Disabled can come from the input or from a reactive form (setDisabledState).
  private readonly _disabledByForm = signal(false);
  protected readonly effectiveDisabled = computed(
    () => this.disabled() || this._disabledByForm(),
  );

  private _onChange: (value: string) => void = () => {};
  protected onTouched: () => void = () => {};

  protected readonly fieldClass = computed(() => {
    const classes = ['cog-text-field', `cog-text-field--${this.size()}`];
    if (this.effectiveDisabled()) {
      classes.push('cog-text-field--disabled');
    }
    return classes.join(' ');
  });

  protected onInput(event: Event): void {
    const next = (event.target as HTMLInputElement).value;
    this.value.set(next);
    this._onChange(next);
  }

  // --- ControlValueAccessor ---
  writeValue(value: string): void {
    this.value.set(value ?? '');
  }
  registerOnChange(fn: (value: string) => void): void {
    this._onChange = fn;
  }
  registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }
  setDisabledState(isDisabled: boolean): void {
    this._disabledByForm.set(isDisabled);
  }
}
