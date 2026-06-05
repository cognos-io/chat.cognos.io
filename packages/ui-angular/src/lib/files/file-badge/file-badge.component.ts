import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from "@angular/core";

import { CognosIconComponent } from "../../icon/icon.component";

import { resolveFileType } from "../file-types";

@Component({
  selector: "cog-file-badge",
  standalone: true,
  imports: [CognosIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span
      class="cog-file-badge"
      [class]="badgeClass()"
      [style.width.px]="size()"
      [style.height.px]="size()"
      [style.border-radius.px]="radius()"
    >
      <cog-icon [name]="fileType().icon" [size]="iconSize()" tone="current" />
    </span>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
      }

      .cog-file-badge {
        display: inline-flex;
        flex: none;
        align-items: center;
        justify-content: center;

        &.cog-file-badge--neutral {
          background: var(--cog-loz-neutral-bg);
          color: var(--cog-loz-neutral-fg);
        }

        &.cog-file-badge--blue {
          background: var(--cog-loz-blue-bg);
          color: var(--cog-loz-blue-fg);
        }

        &.cog-file-badge--green {
          background: var(--cog-loz-green-bg);
          color: var(--cog-loz-green-fg);
        }

        &.cog-file-badge--purple {
          background: var(--cog-loz-purple-bg);
          color: var(--cog-loz-purple-fg);
        }

        &.cog-file-badge--red {
          background: var(--cog-loz-red-bg);
          color: var(--cog-loz-red-fg);
        }
      }
    `,
  ],
})
export class CognosFileBadgeComponent {
  readonly ext = input("");
  readonly size = input(38);
  readonly radius = input(4);

  protected readonly fileType = computed(() => resolveFileType(this.ext()));
  protected readonly iconSize = computed(() => Math.round(this.size() * 0.48));
  protected readonly badgeClass = computed(
    () => `cog-file-badge cog-file-badge--${this.fileType().tone}`,
  );
}
