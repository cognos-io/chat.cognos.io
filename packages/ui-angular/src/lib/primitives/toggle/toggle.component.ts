import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  output,
} from "@angular/core";

import { CognosIconComponent } from "../../icon/icon.component";

@Component({
  selector: "cog-toggle",
  standalone: true,
  imports: [CognosIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      [class]="toggleClass()"
      [disabled]="disabled()"
      [attr.aria-checked]="checked()"
      [attr.aria-label]="label() || null"
      role="switch"
      type="button"
      (click)="onToggle()"
    >
      <span class="cog-toggle__track">
        <span class="cog-toggle__thumb">
          @if (checked()) {
            <cog-icon name="check" [size]="12" tone="current" />
          }
        </span>
      </span>
    </button>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
      }

      .cog-toggle {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        border: 0;
        background: transparent;
        padding: 0;
        cursor: pointer;

        &:focus-visible {
          outline: 2px solid var(--cog-brand);
          outline-offset: 2px;
          border-radius: var(--cog-radius-pill);
        }

        &:disabled {
          opacity: 0.5;
          pointer-events: none;
        }

        &.cog-toggle--checked .cog-toggle__track {
          border-color: var(--cog-success);
          background: var(--cog-success);
        }

        &.cog-toggle--checked .cog-toggle__thumb {
          transform: translateX(12px);
          color: var(--cog-success);
        }
      }

      .cog-toggle__track {
        position: relative;
        display: inline-flex;
        width: 28px;
        height: 16px;
        align-items: center;
        border: 1px solid var(--cog-border-bold);
        border-radius: var(--cog-radius-pill);
        background: transparent;
        transition:
          background-color var(--cog-dur-fast) var(--cog-ease-standard),
          border-color var(--cog-dur-fast) var(--cog-ease-standard);
      }

      .cog-toggle__thumb {
        display: inline-flex;
        width: 12px;
        height: 12px;
        align-items: center;
        justify-content: center;
        margin-inline-start: 1px;
        border-radius: var(--cog-radius-pill);
        background: #ffffff;
        color: transparent;
        box-shadow: 0 0 0 1px var(--cog-border-bold);
        transition:
          transform var(--cog-dur-fast) var(--cog-ease-standard),
          color var(--cog-dur-fast) var(--cog-ease-standard),
          box-shadow var(--cog-dur-fast) var(--cog-ease-standard);
      }
    `,
  ],
})
export class CognosToggleComponent {
  readonly checked = input(false);
  readonly disabled = input(false);
  readonly label = input("");
  readonly checkedChange = output<boolean>();

  protected readonly toggleClass = computed(() => {
    const classes = ["cog-toggle"];

    if (this.checked()) {
      classes.push("cog-toggle--checked");
    }

    return classes.join(" ");
  });

  protected onToggle(): void {
    this.checkedChange.emit(!this.checked());
  }
}
