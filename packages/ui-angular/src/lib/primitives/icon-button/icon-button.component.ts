import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from "@angular/core";
import type { CognosIconName } from "@cognos/ui/icons";

import { CognosIconComponent } from "../../icon/icon.component";

export type CognosIconButtonSize = "md" | "lg";
export type CognosIconButtonType = "button" | "submit" | "reset";

@Component({
  selector: "cog-icon-button",
  standalone: true,
  imports: [CognosIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      [class]="buttonClass()"
      [disabled]="disabled()"
      [attr.aria-label]="title() || null"
      [attr.title]="title() || null"
      [attr.type]="type()"
    >
      <cog-icon
        [name]="name()"
        [size]="16"
        [title]="title()"
        [tone]="selected() ? 'selected' : 'text-subtle'"
      />
    </button>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
      }

      .cog-icon-button {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: 0;
        border-radius: var(--cog-radius-xs);
        background: transparent;
        color: var(--cog-text-subtle);
        cursor: pointer;
        transition:
          background-color var(--cog-dur-fast) var(--cog-ease-standard),
          color var(--cog-dur-fast) var(--cog-ease-standard);

        &:focus-visible {
          outline: 2px solid var(--cog-brand);
          outline-offset: 2px;
        }

        &:disabled {
          opacity: 0.5;
          pointer-events: none;
        }

        &:hover {
          background: var(--cog-surface-hover);
        }

        &:active {
          background: var(--cog-surface-pressed);
        }

        &.cog-icon-button--md {
          width: 32px;
          height: 32px;
        }

        &.cog-icon-button--lg {
          width: 44px;
          height: 44px;
        }

        &.cog-icon-button--selected {
          background: var(--cog-selected-bg);
          color: var(--cog-selected-text);
        }

        &.cog-icon-button--selected:hover {
          background: var(--cog-selected-bg);
        }
      }
    `,
  ],
})
export class CognosIconButtonComponent {
  readonly name = input<CognosIconName>("plus");
  readonly title = input("");
  readonly selected = input(false);
  readonly size = input<CognosIconButtonSize>("md");
  readonly disabled = input(false);
  readonly type = input<CognosIconButtonType>("button");

  protected readonly buttonClass = computed(() => {
    const classes = ["cog-icon-button", `cog-icon-button--${this.size()}`];

    if (this.selected()) {
      classes.push("cog-icon-button--selected");
    }

    return classes.join(" ");
  });
}
