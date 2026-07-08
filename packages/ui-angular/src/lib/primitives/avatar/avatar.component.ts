import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import type { CognosIconName } from '@cognos/ui/icons';

import { CognosIconComponent } from '../../icon/icon.component';

const COGNOS_AVATAR_SIZES = [26, 28, 32, 36, 40] as const;

export type CognosAvatarSize = (typeof COGNOS_AVATAR_SIZES)[number];

// Pastel palette shared with the persona avatars. An avatar with an `icon` +
// `color` shows the icon on the matching pastel background; otherwise it falls
// back to initials on the brand colour.
export const COGNOS_AVATAR_COLORS = [
  'green',
  'blue',
  'indigo',
  'violet',
  'teal',
  'sky',
  'amber',
  'orange',
  'pink',
  'slate',
  // No pastel fill — the icon sits on a transparent background.
  'transparent',
] as const;

export type CognosAvatarColor = (typeof COGNOS_AVATAR_COLORS)[number];

@Component({
  selector: 'cog-avatar',
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
      } @else if (icon()) {
        <cog-icon [name]="icon()!" [size]="iconSize()" tone="current" />
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
        box-shadow: 0 0 0 var(--cog-border-width-strong) var(--cog-surface);
        user-select: none;

        &.cog-avatar--group {
          background: var(--cog-selected-bg);
          color: var(--cog-selected-text);
        }

        &.cog-avatar--icon {
          background: var(--_avatar-bg, #eef0f3);
          color: var(--_avatar-fg, #475569);
        }
      }

      .cog-avatar--green {
        --_avatar-bg: #dcfce7;
        --_avatar-fg: #15803d;
      }
      .cog-avatar--blue {
        --_avatar-bg: #dbeafe;
        --_avatar-fg: #1d4ed8;
      }
      .cog-avatar--indigo {
        --_avatar-bg: #e0e7ff;
        --_avatar-fg: #4338ca;
      }
      .cog-avatar--violet {
        --_avatar-bg: #ede9fe;
        --_avatar-fg: #6d28d9;
      }
      .cog-avatar--teal {
        --_avatar-bg: #ccfbf1;
        --_avatar-fg: #0f766e;
      }
      .cog-avatar--sky {
        --_avatar-bg: #e0f2fe;
        --_avatar-fg: #0369a1;
      }
      .cog-avatar--amber {
        --_avatar-bg: #fef3c7;
        --_avatar-fg: #b45309;
      }
      .cog-avatar--orange {
        --_avatar-bg: #ffedd5;
        --_avatar-fg: #c2410c;
      }
      .cog-avatar--pink {
        --_avatar-bg: #fce7f3;
        --_avatar-fg: #be185d;
      }
      .cog-avatar--slate {
        --_avatar-bg: #eef0f3;
        --_avatar-fg: #475569;
      }
      .cog-avatar--transparent {
        --_avatar-bg: transparent;
        --_avatar-fg: var(--cog-text-subtle, #475569);
        box-shadow: none;
      }
    `,
  ],
})
export class CognosAvatarComponent {
  readonly name = input('');
  readonly group = input(false);
  readonly icon = input<CognosIconName | null>(null);
  readonly color = input<CognosAvatarColor | ''>('');
  readonly size = input<CognosAvatarSize>(32, { transform: avatarSizeAttribute });

  protected readonly avatarClass = computed(() => {
    const classes = ['cog-avatar'];

    if (this.group()) {
      classes.push('cog-avatar--group');
    } else if (this.icon()) {
      classes.push('cog-avatar--icon');
      if (this.color()) {
        classes.push(`cog-avatar--${this.color()}`);
      }
    }

    return classes.join(' ');
  });

  protected readonly initials = computed(() => getInitials(this.name()));
  protected readonly ariaLabel = computed(() =>
    this.group() ? 'Group avatar' : this.name() || 'User avatar',
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
  const parts = name.trim().split(/\s+/).filter(Boolean).slice(0, 2);

  if (parts.length === 0) {
    return '?';
  }

  return parts.map((part) => part[0]?.toUpperCase() ?? '').join('');
}
