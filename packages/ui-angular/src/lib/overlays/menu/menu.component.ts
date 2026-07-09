import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

import type { CognosIconName } from '@cognos/ui/icons';

import { CognosIconComponent } from '../../icon/icon.component';

export type CognosMenuItem = {
  title: string;
  icon?: CognosIconName;
  sub?: string;
  trailing?: string;
  selected?: boolean;
  disabled?: boolean;
};

@Component({
  selector: 'cog-menu',
  standalone: true,
  imports: [CognosIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="cog-menu" role="group" [attr.aria-label]="label() || null">
      @if (label()) {
        <div class="cog-menu__label">{{ label() }}</div>
      }

      @for (item of items(); track item.title; let index = $index) {
        <button
          [class]="itemClass(item)"
          [disabled]="item.disabled"
          role="menuitem"
          type="button"
          (click)="onSelect(index)"
        >
          @if (item.icon) {
            <span class="cog-menu__icon">
              <cog-icon [name]="item.icon!" [size]="16" tone="text-subtle" />
            </span>
          }

          <span class="cog-menu__copy">
            <span class="cog-menu__title">{{ item.title }}</span>
            @if (item.sub) {
              <span class="cog-menu__sub">{{ item.sub }}</span>
            }
          </span>

          @if (item.trailing) {
            <span class="cog-menu__trailing">{{ item.trailing }}</span>
          } @else if (item.selected) {
            <span class="cog-menu__trailing">
              <cog-icon name="check" [size]="16" tone="selected" />
            </span>
          }
        </button>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .cog-menu {
        min-width: 240px;
        border: var(--cog-border-width) solid var(--cog-border);
        border-radius: var(--cog-radius-sm);
        background: var(--cog-surface);
        box-shadow: var(--cog-shadow-overlay);
        padding: var(--cog-space-050) 0;
      }

      .cog-menu__label {
        padding: var(--cog-space-050) var(--cog-space-150);
        color: var(--cog-text-subtlest);
        font-size: var(--cog-fs-overline);
        font-weight: var(--cog-fw-overline);
        line-height: var(--cog-lh-overline);
        letter-spacing: var(--cog-ls-overline);
        text-transform: var(--cog-tt-overline);
      }

      .cog-menu__item {
        display: flex;
        width: 100%;
        min-height: 36px;
        align-items: center;
        gap: var(--cog-space-150);
        border: 0;
        background: transparent;
        color: var(--cog-text);
        padding: var(--cog-space-075) var(--cog-space-150);
        text-align: left;
        cursor: pointer;
        transition: background-color var(--cog-dur-fast) var(--cog-ease-standard);

        &:hover {
          background: var(--cog-surface-hover);
        }

        &:focus-visible {
          outline: var(--cog-border-width-strong) solid var(--cog-brand);
          outline-offset: calc(var(--cog-border-width-strong) * -1);
        }

        &:disabled {
          opacity: 0.5;
          pointer-events: none;
        }

        &.cog-menu__item--selected {
          background: var(--cog-selected-bg);
        }
      }

      .cog-menu__icon {
        display: inline-flex;
        flex: none;
        align-items: center;
        justify-content: center;
      }

      .cog-menu__copy {
        display: grid;
        min-width: 0;
        flex: 1;
      }

      .cog-menu__title {
        font-size: var(--cog-fs-body);
        line-height: var(--cog-lh-body);
      }

      .cog-menu__sub {
        color: var(--cog-text-subtlest);
        font-size: var(--cog-fs-body-sm);
        line-height: var(--cog-lh-body-sm);
      }

      .cog-menu__trailing {
        display: inline-flex;
        flex: none;
        align-items: center;
        justify-content: center;
        color: var(--cog-text-subtlest);
        font-size: var(--cog-fs-body-sm);
      }
    `,
  ],
})
export class CognosMenuComponent {
  readonly label = input('');
  readonly items = input<CognosMenuItem[]>([]);
  readonly itemSelect = output<number>();

  protected itemClass(item: CognosMenuItem): string {
    return item.selected ? 'cog-menu__item cog-menu__item--selected' : 'cog-menu__item';
  }

  protected onSelect(index: number): void {
    this.itemSelect.emit(index);
  }
}
