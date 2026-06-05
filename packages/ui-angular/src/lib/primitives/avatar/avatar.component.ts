import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
} from "@angular/core";

import { CognosIconComponent } from "../../icon/icon.component";

const COGNOS_AVATAR_SIZES = [26, 28, 32, 36, 40] as const;

export type CognosAvatarSize = (typeof COGNOS_AVATAR_SIZES)[number];

@Component({
  selector: "cog-avatar",
  standalone: true,
  imports: [CognosIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span
      [class]="avatarClass()"
      [style.width.px]="size()"
      [style.height.px]="size()"
      [style.fontSize.px]="fontSize()"
      [attr.aria-label]="ariaLabel()"
      role="img"
    >
      @if (group()) {
        <cog-icon name="users" [size]="iconSize()" tone="current" />
      } @else {
        {{ initials() }}
      }
    </span>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
      }

      .cog-avatar {
        display: inline-flex;
        flex: none;
        align-items: center;
        justify-content: center;
        border-radius: var(--cog-radius-pill);
        background: var(--cog-brand);
        color: var(--cog-on-brand);
        font-weight: var(--cog-fw-semibold);
        box-shadow: 0 0 0 2px var(--cog-surface);
        user-select: none;

        &.cog-avatar--group {
          background: var(--cog-selected-bg);
          color: var(--cog-selected-text);
        }
      }
    `,
  ],
})
export class CognosAvatarComponent {
  readonly name = input("");
  readonly group = input(false);
  readonly size = input<CognosAvatarSize>(32, { transform: avatarSizeAttribute });

  protected readonly avatarClass = computed(() => {
    const classes = ["cog-avatar"];

    if (this.group()) {
      classes.push("cog-avatar--group");
    }

    return classes.join(" ");
  });

  protected readonly initials = computed(() => getInitials(this.name()));
  protected readonly ariaLabel = computed(() =>
    this.group() ? "Group avatar" : this.name() || "User avatar",
  );
  protected readonly iconSize = computed(() => (this.size() >= 36 ? 18 : 16));
  protected readonly fontSize = computed(() => Math.max(11, this.size() / 2.4));
}

function avatarSizeAttribute(value: unknown): CognosAvatarSize {
  const parsed = Number(value);

  if (COGNOS_AVATAR_SIZES.includes(parsed as CognosAvatarSize)) {
    return parsed as CognosAvatarSize;
  }

  return 32;
}

function getInitials(name: string): string {
  const parts = name
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  if (parts.length === 0) {
    return "?";
  }

  return parts.map((part) => part[0]?.toUpperCase() ?? "").join("");
}
