import {
  ChangeDetectionStrategy,
  Component,
  computed,
  contentChildren,
  effect,
  input,
  output,
  signal,
} from '@angular/core';

import type { CognosIconName } from '@cognos/ui/icons';

import { CognosIconComponent } from '../../icon/icon.component';

@Component({
  selector: 'cog-nav-item',
  standalone: true,
  imports: [CognosIconComponent],
  host: {
    '[class.cog-nav-item-host--pinned]': 'pinned()',
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="cog-nav-item-group">
      <button
        [class]="itemClass()"
        [style.padding-inline-start.px]="paddingStart()"
        [attr.aria-expanded]="expandable() ? isExpanded() : null"
        type="button"
        (click)="onClick()"
      >
        @if (expandable()) {
          <span class="cog-nav-item__chevron">
            <cog-icon
              [name]="isExpanded() ? 'chevron-down' : 'chevron-right'"
              [size]="16"
              tone="text-subtle"
            />
          </span>
        }

        @if (icon()) {
          <span class="cog-nav-item__icon">
            <cog-icon
              [name]="icon()!"
              [size]="selected() ? 18 : 16"
              [tone]="selected() ? 'selected' : 'text'"
            />
          </span>
        }

        <span class="cog-nav-item__label">{{ label() }}</span>

        @if (displayMeta()) {
          <span class="cog-nav-item__meta">{{ displayMeta() }}</span>
        }

        @if (pinned()) {
          <span class="cog-nav-item__pin">
            <cog-icon name="pin" [size]="14" tone="text-subtlest" />
          </span>
        }
      </button>

      @if (expandable() && isExpanded()) {
        <div class="cog-nav-item__children">
          <ng-content />
        </div>
      }
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      :host(.cog-nav-item-host--pinned) {
        order: -1;
      }

      .cog-nav-item-group {
        display: grid;
        gap: var(--cog-space-050);
      }

      .cog-nav-item {
        position: relative;
        display: flex;
        width: 100%;
        min-height: 36px;
        align-items: center;
        gap: 10px;
        border: 0;
        border-radius: var(--cog-radius-sm);
        background: transparent;
        color: var(--cog-text);
        padding: 0 var(--cog-space-150);
        text-align: left;
        cursor: pointer;
        transition: background-color var(--cog-dur-fast) var(--cog-ease-standard);

        &:hover {
          background: var(--cog-surface-hover);
        }

        &:focus-visible {
          outline: var(--cog-border-width-strong) solid var(--cog-brand);
          outline-offset: var(--cog-border-width-strong);
        }

        &.cog-nav-item--selected {
          background: var(--cog-selected-bg);
          color: var(--cog-selected-text);
          font-weight: var(--cog-fw-semibold);
        }

        &.cog-nav-item--selected::before {
          content: '';
          position: absolute;
          inset-block: 6px;
          inset-inline-start: 0;
          width: 3px;
          border-radius: var(--cog-radius-pill);
          background: var(--cog-selected-border);
        }
      }

      .cog-nav-item__chevron,
      .cog-nav-item__icon,
      .cog-nav-item__pin {
        display: inline-flex;
        flex: none;
        align-items: center;
        justify-content: center;
      }

      .cog-nav-item__children {
        display: grid;
        gap: var(--cog-space-025);
      }

      .cog-nav-item__label {
        min-width: 0;
        flex: 1;
        font-size: var(--cog-fs-body);
        line-height: var(--cog-lh-body);
      }

      .cog-nav-item__meta {
        color: var(--cog-text-subtlest);
        font-size: var(--cog-fs-caption);
        line-height: var(--cog-lh-caption);
      }

      @media (max-width: 767px) {
        .cog-nav-item {
          min-height: 48px;
        }
      }
    `,
  ],
})
export class CognosNavItemComponent {
  readonly icon = input<CognosIconName | null>(null);
  readonly label = input('');
  readonly meta = input('');
  readonly selected = input(false);
  readonly indent = input(0);
  readonly pinned = input(false);
  readonly expandable = input(false);
  readonly expanded = input(false);
  readonly expandedChange = output<boolean>();

  private readonly childItems = contentChildren(CognosNavItemComponent, {
    descendants: false,
  });
  private readonly expandedState = signal(false);

  constructor() {
    effect(() => {
      this.expandedState.set(this.expanded());
    });
  }

  protected readonly isExpanded = computed(() => this.expandedState());

  protected readonly displayMeta = computed(() => {
    const meta = this.meta();

    if (meta) {
      return meta;
    }

    if (!this.expandable()) {
      return '';
    }

    const childCount = this.childItems().length;
    return childCount > 0 ? String(childCount) : '';
  });

  protected readonly itemClass = computed(() => {
    const classes = ['cog-nav-item'];

    if (this.selected()) {
      classes.push('cog-nav-item--selected');
    }

    return classes.join(' ');
  });

  protected readonly paddingStart = computed(
    () => 12 + Math.max(0, this.indent()) * 16,
  );

  protected onClick(): void {
    if (!this.expandable()) {
      return;
    }

    const nextExpanded = !this.expandedState();
    this.expandedState.set(nextExpanded);
    this.expandedChange.emit(nextExpanded);
  }
}
