import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from "@angular/core";
import type { CognosIconName } from "@cognos/ui/icons";

import { CognosIconComponent } from "../../icon/icon.component";

@Component({
  selector: "cog-text-field",
  standalone: true,
  imports: [CognosIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <label [class]="fieldClass()">
      @if (icon()) {
        <span class="cog-text-field__icon">
          <cog-icon [name]="icon()!" [size]="14" tone="text-subtlest" />
        </span>
      }

      <input
        class="cog-text-field__control"
        [disabled]="disabled()"
        [placeholder]="placeholder()"
        [readOnly]="readonly()"
        [type]="type()"
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

      .cog-text-field {
        display: flex;
        min-height: 36px;
        align-items: center;
        gap: var(--cog-space-100);
        border: 2px solid var(--cog-border);
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
export class CognosTextFieldComponent {
  readonly icon = input<CognosIconName | null>(null);
  readonly value = input("");
  readonly placeholder = input("");
  readonly type = input("text");
  readonly ariaLabel = input("");
  readonly disabled = input(false);
  readonly readonly = input(false);
  readonly valueChange = output<string>();

  protected readonly fieldClass = computed(() => {
    const classes = ["cog-text-field"];

    if (this.disabled()) {
      classes.push("cog-text-field--disabled");
    }

    return classes.join(" ");
  });

  protected onInput(event: Event): void {
    const target = event.target as HTMLInputElement;
    this.valueChange.emit(target.value);
  }
}
