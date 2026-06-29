import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

import type { CognosIconName } from '@cognos/ui/icons';

import { CognosIconComponent } from '../../icon/icon.component';
import {
  COGNOS_AVATAR_COLORS,
  CognosAvatarColor,
  CognosAvatarComponent,
} from '../avatar/avatar.component';

/**
 * CognosAvatarPickerComponent (`cog-avatar-picker`) lets a user pick an avatar
 * icon and colour. The icon grid is a radiogroup of icon buttons; the colour row
 * is a radiogroup where each swatch is a live `cog-avatar` preview of the
 * selected icon in that colour — so the palette comes entirely from `cog-avatar`
 * (no hardcoded colours) and the user sees the real result.
 *
 *   <cog-avatar-picker
 *     [icons]="icons" [selectedIcon]="icon()" [selectedColor]="color()" [name]="name()"
 *     (iconChange)="icon.set($event)" (colorChange)="color.set($event)" />
 *
 * Persistence stays with the host; this component only emits the selection.
 */
@Component({
  selector: 'cog-avatar-picker',
  standalone: true,
  imports: [CognosIconComponent, CognosAvatarComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="cog-avatar-picker">
      <div
        class="cog-avatar-picker__icons"
        role="radiogroup"
        [attr.aria-label]="iconAriaLabel() || null"
      >
        @for (icon of icons(); track icon) {
          <button
            type="button"
            class="cog-avatar-picker__icon"
            [class.is-selected]="selectedIcon() === icon"
            [attr.aria-checked]="selectedIcon() === icon"
            [attr.aria-label]="icon"
            role="radio"
            (click)="iconChange.emit(icon)"
          >
            <cog-icon [name]="icon" [size]="18" tone="current" />
          </button>
        }
      </div>

      <div
        class="cog-avatar-picker__colors"
        role="radiogroup"
        [attr.aria-label]="colorAriaLabel() || null"
      >
        @for (color of colors(); track color) {
          <button
            type="button"
            class="cog-avatar-picker__color"
            [class.is-selected]="selectedColor() === color"
            [attr.aria-checked]="selectedColor() === color"
            [attr.aria-label]="color"
            role="radio"
            (click)="colorChange.emit(color)"
          >
            <cog-avatar
              [name]="name()"
              [icon]="selectedIcon()"
              [color]="color"
              [size]="28"
            />
          </button>
        }
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .cog-avatar-picker {
        display: grid;
        gap: var(--cog-space-100);
      }

      .cog-avatar-picker__icons {
        display: grid;
        grid-template-columns: repeat(10, 1fr);
        gap: var(--cog-space-075);
      }

      .cog-avatar-picker__icon {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        aspect-ratio: 1;
        border: 2px solid var(--cog-border);
        border-radius: var(--cog-radius-sm);
        background: var(--cog-surface);
        color: var(--cog-text-subtle);
        cursor: pointer;
        transition:
          border-color var(--cog-dur-fast) var(--cog-ease-standard),
          color var(--cog-dur-fast) var(--cog-ease-standard);
      }

      .cog-avatar-picker__icon:hover {
        color: var(--cog-text);
      }

      .cog-avatar-picker__icon.is-selected {
        border-color: var(--cog-brand);
        color: var(--cog-text);
      }

      .cog-avatar-picker__colors {
        display: flex;
        flex-wrap: wrap;
        gap: var(--cog-space-075);
      }

      .cog-avatar-picker__color {
        display: inline-flex;
        padding: 0;
        border: 2px solid transparent;
        border-radius: var(--cog-radius-pill);
        background: none;
        cursor: pointer;
      }

      .cog-avatar-picker__color.is-selected {
        border-color: var(--cog-text);
      }

      @media (max-width: 640px) {
        .cog-avatar-picker__icons {
          grid-template-columns: repeat(6, 1fr);
        }
      }
    `,
  ],
})
export class CognosAvatarPickerComponent {
  readonly icons = input<readonly CognosIconName[]>([]);
  readonly colors = input<readonly CognosAvatarColor[]>(COGNOS_AVATAR_COLORS);
  readonly selectedIcon = input<CognosIconName | null>(null);
  readonly selectedColor = input<CognosAvatarColor | ''>('');
  readonly name = input('');
  readonly iconAriaLabel = input('');
  readonly colorAriaLabel = input('');

  readonly iconChange = output<CognosIconName>();
  readonly colorChange = output<CognosAvatarColor>();
}
