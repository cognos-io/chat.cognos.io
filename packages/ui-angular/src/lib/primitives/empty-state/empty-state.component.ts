import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import type { CognosIconName } from '@cognos/ui/icons';

import { CognosIconComponent } from '../../icon/icon.component';

/**
 * CognosEmptyStateComponent (`cog-empty-state`) is the standard centred, muted
 * "nothing here" block: an optional icon, an optional title, a message, and an
 * optional projected actions slot. Use it instead of hand-rolling a styled
 * paragraph so empty lists/searches read consistently across the app.
 *
 *   <cog-empty-state icon="search" message="No results" />
 */
@Component({
  selector: 'cog-empty-state',
  standalone: true,
  imports: [CognosIconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="cog-empty-state" [attr.role]="role() || null">
      @if (icon()) {
        <cog-icon
          class="cog-empty-state__icon"
          [name]="icon()!"
          [size]="24"
          tone="text-subtlest"
        />
      }
      @if (title()) {
        <p class="cog-empty-state__title">{{ title() }}</p>
      }
      @if (message()) {
        <p class="cog-empty-state__message">{{ message() }}</p>
      }
      <ng-content />
    </div>
  `,
  styles: [
    `
      :host {
        display: block;
      }

      .cog-empty-state {
        display: flex;
        flex-direction: column;
        align-items: center;
        gap: var(--cog-space-100);
        padding: var(--cog-space-300) var(--cog-space-200);
        text-align: center;
        color: var(--cog-text-subtle);
      }

      .cog-empty-state__title {
        margin: 0;
        color: var(--cog-text);
        font-weight: var(--cog-fw-semibold);
      }

      .cog-empty-state__message {
        margin: 0;
        color: var(--cog-text-subtle);
        font-size: var(--cog-fs-body);
        line-height: var(--cog-lh-body);
        text-wrap: pretty;
      }
    `,
  ],
})
export class CognosEmptyStateComponent {
  readonly icon = input<CognosIconName>();
  readonly title = input('');
  readonly message = input('');
  /** Optional ARIA role, e.g. "status" for live empty results. */
  readonly role = input<string | null>(null);
}
