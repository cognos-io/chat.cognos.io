import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import type { CognosIconName } from '@cognos/ui/icons';

import { CognosIconComponent } from '../icon/icon.component';

export type CognosButtonAppearance =
  | 'primary'
  | 'default'
  | 'subtle'
  | 'link'
  | 'danger';

export type CognosButtonSize = 'md' | 'lg';
export type CognosButtonType = 'button' | 'submit' | 'reset';

@Component({
  selector: 'cog-button',
  standalone: true,
  imports: [CognosIconComponent],
  host: {
    '[class.cog-button-host--full-width]': 'fullWidth()',
  },
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      [class]="buttonClass()"
      [disabled]="disabled()"
      [attr.aria-label]="ariaLabel() || null"
      [attr.title]="title() || null"
      [attr.type]="type()"
    >
      @if (icon()) {
        <cog-icon [name]="icon()!" [size]="16" tone="current" />
      }

      <ng-content />

      @if (iconAfter()) {
        <cog-icon [name]="iconAfter()!" [size]="16" tone="current" />
      }
    </button>
  `,
  styles: [
    `
      :host {
        display: inline-block;
      }

      :host(.cog-button-host--full-width) {
        display: block;
        width: 100%;
        min-width: 0;
      }

      .cog-button {
        display: inline-flex;
        box-sizing: border-box;
        max-width: 100%;
        min-height: 32px;
        align-items: center;
        justify-content: center;
        gap: var(--cog-space-075);
        border: 0;
        border-radius: var(--cog-radius-xs);
        padding: 0 var(--cog-space-150);
        font: inherit;
        font-size: var(--cog-fs-label);
        font-weight: var(--cog-fw-label);
        line-height: var(--cog-lh-label);
        cursor: pointer;
        text-decoration: none;
        transition:
          background-color var(--cog-dur-fast) var(--cog-ease-standard),
          color var(--cog-dur-fast) var(--cog-ease-standard);

        &.cog-button--full-width {
          width: 100%;
        }
      }

      .cog-button:focus-visible {
        outline: var(--cog-border-width-strong) solid var(--cog-brand);
        outline-offset: var(--cog-border-width-strong);
      }

      .cog-button:disabled {
        opacity: 0.5;
        pointer-events: none;
      }

      .cog-button--md {
        min-height: 32px;
      }

      .cog-button--lg {
        min-height: 44px;
      }

      .cog-button--primary {
        background: var(--cog-brand);
        color: var(--cog-on-brand);
      }

      .cog-button--primary:hover {
        background: var(--cog-brand-hover);
      }

      .cog-button--primary:active {
        background: var(--cog-brand-pressed);
      }

      .cog-button--default {
        background: var(--cog-surface-hover);
        color: var(--cog-text-subtle);
      }

      .cog-button--default:hover {
        background: var(--cog-surface-pressed);
      }

      .cog-button--default:active {
        background: var(--cog-border);
      }

      .cog-button--subtle {
        background: transparent;
        color: var(--cog-text-subtle);
      }

      .cog-button--subtle:hover {
        background: var(--cog-surface-hover);
      }

      .cog-button--subtle:active {
        background: var(--cog-surface-pressed);
      }

      .cog-button--link {
        background: transparent;
        color: var(--cog-link);
        padding-inline: var(--cog-space-025);
      }

      .cog-button--link:hover {
        text-decoration: underline;
      }

      .cog-button--link:active {
        color: var(--cog-brand-pressed);
      }

      .cog-button--danger {
        background: var(--cog-danger);
        color: #ffffff;
      }

      .cog-button--danger:hover {
        background: var(--cog-danger-text);
      }

      .cog-button--danger:active {
        filter: brightness(0.95);
      }
    `,
  ],
})
export class CognosButtonComponent {
  readonly appearance = input<CognosButtonAppearance>('default');
  readonly size = input<CognosButtonSize>('md');
  readonly disabled = input(false);
  readonly ariaLabel = input('');
  readonly fullWidth = input(false);
  readonly icon = input<CognosIconName | null>(null);
  readonly iconAfter = input<CognosIconName | null>(null);
  readonly title = input('');
  readonly type = input<CognosButtonType>('button');

  protected readonly buttonClass = computed(() => {
    const classes = [
      'cog-button',
      `cog-button--${this.appearance()}`,
      `cog-button--${this.size()}`,
    ];

    if (this.fullWidth()) {
      classes.push('cog-button--full-width');
    }

    return classes.join(' ');
  });
}
