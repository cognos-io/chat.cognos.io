import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

import type { CognosIconName } from '@cognos/ui/icons';

import { CognosIconComponent } from '../../icon/icon.component';

export type CognosCalloutTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

// CognosCalloutComponent renders a tinted note box with an optional leading
// icon — used for inline reassurances and warnings (e.g. "this key never
// reaches our servers"). The tone tints the background and colours the icon;
// projected content stays in the default text colour so the message reads as
// body copy rather than a coloured banner.
@Component({
  selector: 'cog-callout',
  standalone: true,
  imports: [CognosIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div [class]="calloutClass()">
      @if (icon()) {
        <span class="cog-callout__icon">
          <cog-icon [name]="icon()!" [size]="18" tone="current" />
        </span>
      }

      <div class="cog-callout__content">
        <ng-content />
      </div>
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .cog-callout {
        display: flex;
        align-items: flex-start;
        gap: var(--cog-space-150);
        border-radius: var(--cog-radius-md);
        padding: var(--cog-space-150);
        color: var(--cog-text);
        font-size: var(--cog-fs-body-sm);
        line-height: var(--cog-lh-body-sm);
      }

      .cog-callout__icon {
        display: inline-flex;
        flex: none;
        line-height: 0;
      }

      .cog-callout__content {
        min-width: 0;
      }

      /* Bold spans (e.g. injected via [innerHTML] translations) should stand
         out without changing colour. */
      .cog-callout__content ::ng-deep strong {
        font-weight: var(--cog-fw-semibold);
      }

      .cog-callout--neutral {
        background: var(--cog-surface-sunken);
      }

      .cog-callout--neutral .cog-callout__icon {
        color: var(--cog-text-subtle);
      }

      .cog-callout--info {
        background: var(--cog-info-bg);
      }

      .cog-callout--info .cog-callout__icon {
        color: var(--cog-info-text);
      }

      .cog-callout--success {
        background: var(--cog-success-bg);
      }

      .cog-callout--success .cog-callout__icon {
        color: var(--cog-success-text);
      }

      .cog-callout--warning {
        background: var(--cog-warning-bg);
      }

      .cog-callout--warning .cog-callout__icon {
        color: var(--cog-warning-text);
      }

      .cog-callout--danger {
        background: var(--cog-danger-bg);
      }

      .cog-callout--danger .cog-callout__icon {
        color: var(--cog-danger-text);
      }
    `,
  ],
})
export class CognosCalloutComponent {
  readonly tone = input<CognosCalloutTone>('neutral');
  readonly icon = input<CognosIconName | null>(null);

  protected readonly calloutClass = computed(
    () => `cog-callout cog-callout--${this.tone()}`,
  );
}
