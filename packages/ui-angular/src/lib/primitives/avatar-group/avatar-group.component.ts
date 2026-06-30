import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import {
  CognosAvatarComponent,
  type CognosAvatarSize,
} from '../avatar/avatar.component';

const COGNOS_AVATAR_GROUP_SIZES = [26, 28, 32, 36, 40] as const;

export type CognosAvatarGroupItem =
  | { name: string; group?: false }
  | { group: true; name?: string };

@Component({
  selector: 'cog-avatar-group',
  standalone: true,
  imports: [CognosAvatarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <span class="cog-avatar-group" [style.--_avatar-overlap.px]="overlap()">
      @for (item of items(); track item.group ? 'group-' + $index : item.name) {
        <span class="cog-avatar-group__item">
          <cog-avatar
            [group]="item.group ?? false"
            [name]="item.name ?? ''"
            [size]="size()"
          />
        </span>
      }
    </span>
  `,
  styles: [
    `
      :host {
        display: inline-flex;
      }

      .cog-avatar-group {
        display: inline-flex;
        align-items: center;
      }

      .cog-avatar-group__item {
        display: inline-flex;
      }

      .cog-avatar-group__item + .cog-avatar-group__item {
        margin-inline-start: calc(var(--_avatar-overlap) * -1);
      }
    `,
  ],
})
export class CognosAvatarGroupComponent {
  readonly items = input<CognosAvatarGroupItem[]>([]);
  readonly size = input<CognosAvatarSize>(32, {
    transform: avatarGroupSizeAttribute,
  });

  protected readonly overlap = computed(() => Math.round(this.size() / 3.5));
}

function avatarGroupSizeAttribute(value: unknown): CognosAvatarSize {
  const parsed = Number(value);

  if (COGNOS_AVATAR_GROUP_SIZES.includes(parsed as CognosAvatarSize)) {
    return parsed as CognosAvatarSize;
  }

  return 32;
}
